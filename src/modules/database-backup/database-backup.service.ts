import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import { ProjectAccessService } from '../project/project-access.service';
import { composeLabels, DockerService } from '../docker/docker.service';
import { ENGINES } from '../managed-database/engines';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
  volumeNameForDb,
} from '../managed-database/managed-database.service';
import { NotificationService } from '../notification/notification.service';
import { APP_NETWORK } from '../proxy/proxy.service';
import { BACKUP_RECIPES } from './backup-recipes';
import { BACKUPS_MOUNT as MOUNT, BACKUPS_VOLUME } from './backups-volume';
import {
  BackupScope,
  BackupTrigger,
  DatabaseBackup,
} from './database-backup.entity';

export { BACKUPS_VOLUME };
/** Tiny image for file helpers (delete/download) so no engine image is needed. */
const HELPER_IMAGE = 'busybox:stable';

@Injectable()
export class DatabaseBackupService {
  private readonly logger = new Logger(DatabaseBackupService.name);

  constructor(
    @InjectRepository(DatabaseBackup)
    readonly repo: Repository<DatabaseBackup>,
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
    private readonly notifications: NotificationService,
    private readonly destinations: BackupDestinationService,
    private readonly config: ConfigService,
    private readonly access: ProjectAccessService,
  ) {}

  async findOwnedOrFail(id: string, ownerId: string): Promise<DatabaseBackup> {
    const b = await this.repo.findOne({
      where: { id },
      relations: { database: { project: true } },
    });
    if (!b) throw new NotFoundException('Backup not found');
    await this.access.assertAccess(ownerId, b.database.project);
    return b;
  }

  /**
   * Creates the row and runs the dump; always ends in success/failed. With a
   * destination set, the file is also copied off-site — an upload failure
   * fails the backup (the local file stays for download), because the point
   * of a destination is that the copy exists somewhere else.
   */
  async backup(
    db: ManagedDatabase,
    trigger: BackupTrigger,
  ): Promise<DatabaseBackup> {
    const recipe = BACKUP_RECIPES[db.engine];
    const scope: BackupScope =
      db.backupAllDatabases && recipe.dumpAll ? 'all' : 'database';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${db.slug}/${stamp}${scope === 'all' ? '.all' : ''}.${recipe.extension}`;
    const row = await this.repo.save(
      this.repo.create({
        databaseId: db.id,
        filename,
        status: 'running',
        trigger,
        scope,
      }),
    );
    try {
      const dump = scope === 'all' ? recipe.dumpAll! : recipe.dump;
      const { code, output } = await this.runRecipe(
        db,
        `mkdir -p "$(dirname "$BACKUP_FILE")" && ${dump} && stat -c %s "$BACKUP_FILE"`,
        filename,
      );
      if (code !== 0) throw new Error(lastLine(output) || `exit ${code}`);
      row.sizeBytes = lastLine(output);
      if (db.backupDestinationId) {
        row.destinationId = db.backupDestinationId;
        row.remoteKey = await this.destinations
          .upload(db.backupDestinationId, filename)
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
      this.logger.warn(`Backup ${filename} failed: ${row.errorMessage}`);
    }
    row.finishedAt = new Date();
    const saved = await this.repo.save(row);
    if (saved.status === 'failed') this.notifyFailure(db, saved);
    return saved;
  }

  /** Fire-and-forget: a channel outage must not affect the backup result. */
  private notifyFailure(db: ManagedDatabase, backup: DatabaseBackup): void {
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    void this.notifications
      .broadcast('backupFailure', {
        title: `Backup failed: ${db.name}`,
        level: 'failure',
        fields: [
          ['Database', `${db.name} (${db.engine})`],
          ['Trigger', backup.trigger],
          ['Error', (backup.errorMessage ?? 'unknown').slice(0, 500)],
        ],
        url: origin ? `${origin}/databases/${db.id}` : undefined,
        data: {
          event: 'backup.failure',
          backupId: backup.id,
          databaseId: db.id,
          database: db.name,
          slug: db.slug,
          trigger: backup.trigger,
          error: backup.errorMessage,
        },
      })
      .catch((err) =>
        this.logger.warn(`Backup notification failed: ${String(err)}`),
      );
  }

  /** Restores a successful backup into its database (data is overwritten). */
  async restore(backup: DatabaseBackup, db: ManagedDatabase): Promise<void> {
    if (backup.status !== 'success')
      throw new Error('Only successful backups can be restored');
    const recipe = BACKUP_RECIPES[db.engine];
    if (recipe.restoreMode === 'online') {
      const script =
        backup.scope === 'all' && recipe.restoreAll
          ? recipe.restoreAll
          : recipe.restore;
      const { code, output } = await this.runRecipe(
        db,
        script,
        backup.filename,
      );
      if (code !== 0) throw new Error(lastLine(output) || `exit ${code}`);
      return;
    }
    // offline-volume: stop the server, rewrite its data volume, start again.
    const c = await this.docker.findContainerByName(containerNameForDb(db));
    if (!c) throw new Error('Database has no container');
    await this.docker.engine.stopContainer(c.Id);
    try {
      const { code, output } = await this.runRecipe(
        db,
        recipe.restore,
        backup.filename,
        [`${volumeNameForDb(db)}:/data`],
      );
      if (code !== 0) throw new Error(lastLine(output) || `exit ${code}`);
    } finally {
      await this.docker.engine.startContainer(c.Id);
    }
  }

  /** Streams the backup file to `sink` (tar framing stripped). */
  async download(
    backup: DatabaseBackup,
    sink: NodeJS.WritableStream,
  ): Promise<void> {
    // A stopped helper container is enough for the archive endpoint.
    await this.docker.ensureImage(HELPER_IMAGE);
    const id = await this.docker.engine.createContainer({
      Image: HELPER_IMAGE,
      Cmd: ['true'],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}:ro`] },
    });
    await new Promise<void>((resolve, reject) =>
      this.docker.engine.streamFileFromContainer(
        id,
        `${MOUNT}/${backup.filename}`,
        sink,
        (err) => (err ? reject(err) : resolve()),
      ),
    ).finally(() =>
      this.docker.engine.removeContainer(id, true).catch(() => undefined),
    );
  }

  /** Removes the local file and, if it was uploaded, the remote object. */
  async deleteFile(backup: DatabaseBackup): Promise<void> {
    if (backup.destinationId && backup.remoteKey) {
      await this.destinations.remove(backup.destinationId, backup.remoteKey);
    }
    await this.docker.ensureImage(HELPER_IMAGE);
    await this.docker.runOnce({
      Image: HELPER_IMAGE,
      Cmd: ['rm', '-f', `${MOUNT}/${backup.filename}`],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}`] },
    });
  }

  /** Deletes the oldest scheduled backups beyond `keep`. */
  async prune(db: ManagedDatabase): Promise<number> {
    const old = await this.repo.find({
      where: { databaseId: db.id, trigger: 'scheduled', status: 'success' },
      order: { createdAt: 'DESC' },
      skip: Math.max(db.backupKeep, 1),
    });
    for (const b of old) {
      await this.deleteFile(b).catch(() => undefined);
      await this.repo.remove(b);
    }
    return old.length;
  }

  private async runRecipe(
    db: ManagedDatabase,
    script: string,
    filename: string,
    extraBinds: string[] = [],
  ): Promise<{ code: number; output: string }> {
    const spec = ENGINES[db.engine];
    const image = `${spec.image}:${db.imageTag}`;
    await this.docker.ensureImage(image);
    await this.docker.engine.createVolume(BACKUPS_VOLUME);
    const password = await this.databases.password(db);
    return this.docker.runOnceWithOutput({
      Image: image,
      Entrypoint: ['sh', '-c', script],
      Env: [
        `DB_HOST=${containerNameForDb(db)}`,
        `DB_PORT=${spec.port}`,
        `DB_USER=${db.username}`,
        `DB_PASSWORD=${password}`,
        `DB_NAME=${db.databaseName}`,
        `BACKUP_FILE=${MOUNT}/${filename}`,
      ],
      Labels: {
        'aoox.component': 'backup',
        ...composeLabels('backup-helper'),
      },
      HostConfig: {
        NetworkMode: APP_NETWORK,
        Binds: [`${BACKUPS_VOLUME}:${MOUNT}`, ...extraBinds],
      },
    });
  }
}

function lastLine(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^\S+Z\s+/, '').trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}
