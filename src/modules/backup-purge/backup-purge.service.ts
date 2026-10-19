import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import {
  BACKUPS_MOUNT,
  BACKUPS_VOLUME,
} from '../database-backup/backups-volume';
import { DatabaseBackup } from '../database-backup/database-backup.entity';
import {
  composeLabels,
  DockerHandle,
  DockerService,
} from '../docker/docker.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { VolumeBackup } from '../volume-backup/volume-backup.entity';

const HELPER_IMAGE = 'busybox:stable';
/** Files per helper run: keeps the command line far below any limit. */
const BATCH = 100;

/**
 * Removes one file, then every parent directory that became empty. `rmdir`
 * refuses a non-empty directory, so a folder that still holds anything else
 * (another resource's backup) is never touched. The file list arrives as
 * positional arguments, never interpolated into the script.
 */
export const PURGE_SCRIPT = `for f in "$@"; do
  rm -f -- "${BACKUPS_MOUNT}/$f"
  d=$(dirname -- "$f")
  while [ "$d" != "." ] && [ "$d" != "/" ]; do
    rmdir -- "${BACKUPS_MOUNT}/$d" 2>/dev/null || break
    d=$(dirname -- "$d")
  done
done`;

/**
 * Backup filenames are written by aoox (`<slug>/<stamp>.<ext>`,
 * `<appName>/<mount>/<stamp>.tar.gz`). The value comes from a row, but it is
 * checked again before it reaches a path: relative, no `..`, no odd characters.
 */
export function isSafeBackupPath(name: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._@:-]*(\/[A-Za-z0-9._@:-]+)*$/.test(name)) {
    return false;
  }
  return name.split('/').every((s) => s !== '.' && s !== '..');
}

export interface PurgeReport {
  /** Local files the helper was asked to remove (rows with a safe filename). */
  localFiles: number;
  /** S3 objects a delete was requested for (the destination logs its own failures). */
  remoteObjects: number;
  /** Human-readable problems; the delete itself never fails because of them. */
  failures: string[];
}

interface Ref {
  filename: string;
  destinationId: string | null;
  remoteKey: string | null;
}

/**
 * Deleting a database or an application with `purge` also removes the backup
 * files of that resource, found through the backup rows (never by guessing
 * folder names), and their S3 copies. Without it the rows go with the FK
 * cascade but the files would stay in `aoox_backups`, unreachable from the UI.
 * Best effort: a failure is logged and reported, and never blocks the delete.
 * Must run BEFORE the rows are removed.
 */
@Injectable()
export class BackupPurgeService {
  private readonly logger = new Logger(BackupPurgeService.name);

  constructor(
    @InjectRepository(DatabaseBackup)
    private readonly dbBackups: Repository<DatabaseBackup>,
    @InjectRepository(VolumeBackup)
    private readonly volumeBackups: Repository<VolumeBackup>,
    private readonly destinations: BackupDestinationService,
    private readonly docker: DockerService,
    private readonly remote: RemoteDockerService,
  ) {}

  /** Database dumps always live on the aoox host. */
  async purgeDatabase(databaseId: string): Promise<PurgeReport> {
    const rows = await this.dbBackups.find({ where: { databaseId } });
    return this.purge(rows, () => Promise.resolve(this.docker));
  }

  /** Volume backups live on the daemon the application runs on. */
  async purgeApplication(
    applicationId: string,
    serverId: string | null,
  ): Promise<PurgeReport> {
    const rows = await this.volumeBackups.find({ where: { applicationId } });
    return this.purge(rows, () => this.remote.forServer(serverId));
  }

  private async purge(
    rows: Ref[],
    handle: () => Promise<DockerHandle>,
  ): Promise<PurgeReport> {
    const report: PurgeReport = {
      localFiles: 0,
      remoteObjects: 0,
      failures: [],
    };
    if (rows.length === 0) return report;
    let docker: DockerHandle | null = null;
    try {
      docker = await handle();
    } catch (err) {
      report.failures.push(`Docker is not reachable: ${describe(err)}`);
    }
    for (const r of rows) {
      if (!r.destinationId || !r.remoteKey) continue;
      try {
        // Never throws itself (it logs); the catch covers a bad handle.
        await this.destinations.remove(
          r.destinationId,
          r.remoteKey,
          docker ?? undefined,
        );
        report.remoteObjects++;
      } catch (err) {
        report.failures.push(`S3 copy ${r.remoteKey}: ${describe(err)}`);
      }
    }
    const files = rows.map((r) => r.filename).filter(isSafeBackupPath);
    const skipped = rows.length - files.length;
    if (skipped > 0) {
      report.failures.push(`${skipped} backup row(s) with an unsafe filename`);
    }
    if (docker && files.length > 0) {
      try {
        await docker.ensureImage(HELPER_IMAGE);
        for (let i = 0; i < files.length; i += BATCH) {
          const batch = files.slice(i, i + BATCH);
          const code = await docker.runOnce({
            Image: HELPER_IMAGE,
            Cmd: ['sh', '-c', PURGE_SCRIPT, 'sh', ...batch],
            Labels: composeLabels('backup-helper'),
            HostConfig: { Binds: [`${BACKUPS_VOLUME}:${BACKUPS_MOUNT}`] },
          });
          if (code !== 0) {
            throw new Error(`the cleanup helper exited with code ${code}`);
          }
          report.localFiles += batch.length;
        }
      } catch (err) {
        report.failures.push(`Local backup files: ${describe(err)}`);
      }
    }
    if (report.failures.length > 0) {
      this.logger.warn(
        `Backup purge finished with problems: ${report.failures.join('; ')}`,
      );
    }
    return report;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
