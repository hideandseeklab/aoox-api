import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import {
  ApplicationService,
  containerNameFor,
} from '../application/application.service';
import { Mount } from '../application/mount.entity';
import { SwarmDeployService } from '../application/swarm-deploy.service';
import { volumeNameFor } from '../application/mounts';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import { ProjectAccessService } from '../project/project-access.service';
import {
  BACKUPS_MOUNT as MOUNT,
  BACKUPS_VOLUME,
} from '../database-backup/backups-volume';
import { composeLabels, DockerHandle } from '../docker/docker.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { NotificationService } from '../notification/notification.service';
import { VolumeBackup, VolumeBackupTrigger } from './volume-backup.entity';

/** Has tar+gzip; the same image the database-backup helpers use. */
const HELPER_IMAGE = 'busybox:stable';
const DATA = '/data';

/**
 * Backups of an application's `volume` mounts: a one-off busybox tars the
 * volume into the shared backups volume (`<appName>/<mount>/<stamp>.tar.gz`),
 * optionally uploads it to the app's S3 destination, and restores by
 * stopping the container, emptying the volume and untarring. Everything
 * runs on the app's own daemon (host or remote server): its backups volume,
 * its rclone helper, its downloads.
 */
@Injectable()
export class VolumeBackupService {
  private readonly logger = new Logger(VolumeBackupService.name);

  constructor(
    @InjectRepository(VolumeBackup)
    readonly repo: Repository<VolumeBackup>,
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly destinations: BackupDestinationService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly access: ProjectAccessService,
  ) {}

  async findOwnedOrFail(id: string, ownerId: string): Promise<VolumeBackup> {
    const b = await this.repo.findOne({
      where: { id },
      relations: { application: { project: true }, mount: true },
    });
    if (!b) throw new NotFoundException('Backup not found');
    await this.access.assertAccess(ownerId, b.application.project);
    return b;
  }

  /** Volume mounts of an app that can be backed up. */
  async volumeMounts(app: Application): Promise<Mount[]> {
    return this.applications.mounts.find({
      where: { applicationId: app.id, type: 'volume' },
      order: { createdAt: 'ASC' },
    });
  }

  /** Runs one backup; always ends in success/failed (upload failure = failed, file kept). */
  async backup(
    app: Application,
    mount: Mount,
    trigger: VolumeBackupTrigger,
  ): Promise<VolumeBackup> {
    if (mount.type !== 'volume') {
      throw new BadRequestException('Only volume mounts can be backed up');
    }
    const volume = volumeNameFor(app, mount);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${app.appName}/${mount.name}/${stamp}.tar.gz`;
    const row = await this.repo.save(
      this.repo.create({
        applicationId: app.id,
        mountId: mount.id,
        volume,
        filename,
        status: 'running',
        trigger,
      }),
    );
    try {
      const docker = await this.remote.forServer(app.serverId);
      const { code, output } = await this.runHelper(
        docker,
        `mkdir -p "$(dirname "$BACKUP_FILE")" && tar czf "$BACKUP_FILE" -C ${DATA} . && stat -c %s "$BACKUP_FILE"`,
        filename,
        [`${volume}:${DATA}:ro`],
      );
      if (code !== 0) throw new Error(lastLine(output) || `exit ${code}`);
      row.sizeBytes = lastLine(output);
      if (app.backupDestinationId) {
        row.destinationId = app.backupDestinationId;
        row.remoteKey = await this.destinations
          .upload(app.backupDestinationId, filename, docker)
          .catch((err: unknown) => {
            throw new Error(
              `Upload to destination failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
      row.status = 'success';
    } catch (err) {
      row.status = 'failed';
      row.errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Volume backup ${filename} failed: ${row.errorMessage}`);
    }
    row.finishedAt = new Date();
    const saved = await this.repo.save(row);
    if (saved.status === 'failed') this.notifyFailure(app, mount, saved);
    return saved;
  }

  /**
   * Overwrites the mount's current volume with the archive. The container is
   * stopped meanwhile so nothing writes to the volume, then started again
   * even if the restore failed.
   */
  async restore(backup: VolumeBackup): Promise<void> {
    if (backup.status !== 'success') {
      throw new BadRequestException('Only successful backups can be restored');
    }
    const app = backup.application;
    const mount = backup.mount;
    const volume = volumeNameFor(app, mount);
    const docker = await this.remote.forServer(app.serverId);
    const service = app.deployMode === 'service';
    const c = service
      ? null
      : await docker.findContainerByName(containerNameFor(app));
    const wasRunning = service
      ? (await this.swarmDeploy.taskContainers(app)).length > 0
      : c?.State === 'running';
    // Nothing may write to the volume meanwhile: stop the container, or
    // scale the service to 0 (its tasks share the volume on this node).
    if (service && wasRunning) await this.swarmDeploy.scale(app, 0);
    if (c && wasRunning) await docker.engine.stopContainer(c.Id);
    try {
      await docker.engine.createVolume(volume);
      const { code, output } = await this.runHelper(
        docker,
        // `.[!.]*` and `..?*` cover dotfiles without touching `.`/`..`.
        `cd ${DATA} && rm -rf ./* ./.[!.]* ./..?* 2>/dev/null; tar xzf "$BACKUP_FILE" -C ${DATA}`,
        backup.filename,
        [`${volume}:${DATA}`],
      );
      if (code !== 0) throw new Error(lastLine(output) || `exit ${code}`);
    } finally {
      if (c && wasRunning) await docker.engine.startContainer(c.Id);
      if (service && wasRunning)
        await this.swarmDeploy.scale(app, app.replicas);
    }
  }

  /** Streams the archive to `sink` (tar framing of the archive endpoint stripped). */
  async download(
    backup: VolumeBackup,
    sink: NodeJS.WritableStream,
  ): Promise<void> {
    const docker = await this.remote.forServer(backup.application.serverId);
    await docker.ensureImage(HELPER_IMAGE);
    const id = await docker.engine.createContainer({
      Image: HELPER_IMAGE,
      Cmd: ['true'],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}:ro`] },
    });
    await new Promise<void>((resolve, reject) =>
      docker.engine.streamFileFromContainer(
        id,
        `${MOUNT}/${backup.filename}`,
        sink,
        (err) => (err ? reject(err) : resolve()),
      ),
    ).finally(() =>
      docker.engine.removeContainer(id, true).catch(() => undefined),
    );
  }

  /** `serverId` of the owning app; rows loaded without the relation pass it explicitly. */
  async deleteFile(
    backup: VolumeBackup,
    serverId: string | null = backup.application?.serverId ?? null,
  ): Promise<void> {
    const docker = await this.remote.forServer(serverId);
    if (backup.destinationId && backup.remoteKey) {
      await this.destinations.remove(
        backup.destinationId,
        backup.remoteKey,
        docker,
      );
    }
    await docker.ensureImage(HELPER_IMAGE);
    await docker.runOnce({
      Image: HELPER_IMAGE,
      Cmd: ['rm', '-f', `${MOUNT}/${backup.filename}`],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}`] },
    });
  }

  /** Deletes the oldest scheduled backups of one mount beyond `app.backupKeep`. */
  async prune(app: Application, mount: Mount): Promise<number> {
    const old = await this.repo.find({
      where: { mountId: mount.id, trigger: 'scheduled', status: 'success' },
      order: { createdAt: 'DESC' },
      skip: Math.max(app.backupKeep, 1),
    });
    for (const b of old) {
      await this.deleteFile(b, app.serverId).catch(() => undefined);
      await this.repo.remove(b);
    }
    return old.length;
  }

  private async runHelper(
    docker: DockerHandle,
    script: string,
    filename: string,
    extraBinds: string[],
  ): Promise<{ code: number; output: string }> {
    await docker.ensureImage(HELPER_IMAGE);
    await docker.engine.createVolume(BACKUPS_VOLUME);
    return docker.runOnceWithOutput({
      Image: HELPER_IMAGE,
      Entrypoint: ['sh', '-c', script],
      Env: [`BACKUP_FILE=${MOUNT}/${filename}`],
      Labels: {
        'aoox.component': 'backup',
        ...composeLabels('backup-helper'),
      },
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}`, ...extraBinds] },
    });
  }

  private notifyFailure(
    app: Application,
    mount: Mount,
    backup: VolumeBackup,
  ): void {
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    void this.notifications
      .broadcast('backupFailure', {
        title: `Volume backup failed: ${app.name} (${mount.name})`,
        level: 'failure',
        fields: [
          ['Application', app.name],
          ['Volume', mount.name ?? ''],
          ['Trigger', backup.trigger],
          ['Error', (backup.errorMessage ?? 'unknown').slice(0, 500)],
        ],
        url: origin ? `${origin}/applications/${app.id}` : undefined,
        data: {
          event: 'volume-backup.failure',
          backupId: backup.id,
          applicationId: app.id,
          mountId: mount.id,
          trigger: backup.trigger,
          error: backup.errorMessage,
        },
      })
      .catch((err) =>
        this.logger.warn(`Backup notification failed: ${String(err)}`),
      );
  }
}

function lastLine(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^\S+Z\s+/, '').trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}
