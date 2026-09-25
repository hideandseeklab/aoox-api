import { Injectable } from '@nestjs/common';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import {
  composeLabels,
  DockerHandle,
  DockerService,
} from '../docker/docker.service';
import { BACKUPS_MOUNT as MOUNT, BACKUPS_VOLUME } from './backups-volume';

const HELPER_IMAGE = 'busybox:stable';

/** What a backup row needs for the local/remote file dance. */
export interface BackupFileRef {
  filename: string;
  destinationId: string | null;
  remoteKey: string | null;
}

/**
 * Local presence and S3 pull-back for backup files (databases and volumes
 * share the backups volume). One `find` lists every file, so a backup list
 * can be annotated with `local: boolean` in a single helper run.
 */
@Injectable()
export class BackupFilesService {
  constructor(
    private readonly docker: DockerService,
    private readonly destinations: BackupDestinationService,
  ) {}

  /** Relative paths of every file in the backups volume. */
  async localFiles(docker: DockerHandle = this.docker): Promise<Set<string>> {
    await docker.ensureImage(HELPER_IMAGE);
    await docker.engine.createVolume(BACKUPS_VOLUME);
    const { output } = await docker.runOnceWithOutput({
      Image: HELPER_IMAGE,
      Cmd: ['find', MOUNT, '-type', 'f'],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}:ro`] },
    });
    const prefix = `${MOUNT}/`;
    return new Set(
      output
        .split('\n')
        .map((l) => l.replace(/^\S+Z\s+/, '').trim())
        .filter((l) => l.startsWith(prefix))
        .map((l) => l.slice(prefix.length)),
    );
  }

  /** Annotates rows with whether their file is on this server right now. */
  async annotate<T extends { filename: string }>(
    rows: T[],
    docker: DockerHandle = this.docker,
  ): Promise<Array<T & { local: boolean }>> {
    if (rows.length === 0) return [];
    const files = await this.localFiles(docker);
    return rows.map((r) => ({ ...r, local: files.has(r.filename) }));
  }

  /**
   * Makes sure the file exists locally, pulling it from the destination
   * when it was pruned/lost. Throws when it is nowhere to be found.
   */
  async ensureLocal(
    backup: BackupFileRef,
    docker: DockerHandle = this.docker,
  ): Promise<{ fetched: boolean }> {
    const files = await this.localFiles(docker);
    if (files.has(backup.filename)) return { fetched: false };
    if (!backup.destinationId || !backup.remoteKey) {
      throw new Error(
        'Backup file is no longer on this server and has no S3 copy',
      );
    }
    await this.destinations.download(
      backup.destinationId,
      backup.remoteKey,
      backup.filename,
      docker,
    );
    return { fetched: true };
  }
}
