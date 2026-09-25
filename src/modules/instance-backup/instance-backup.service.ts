import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { gunzipSync, gzipSync } from 'zlib';
import { tarFiles } from '../application/nixpacks-builder.service';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import { BackupFilesService } from '../database-backup/backup-files.service';
import { BackupSchedulerService } from '../database-backup/backup-scheduler.service';
import {
  BACKUPS_MOUNT as MOUNT,
  BACKUPS_VOLUME,
} from '../database-backup/backups-volume';
import { decryptSecret } from '../docker/secret.util';
import { composeLabels, DockerService } from '../docker/docker.service';
import { JobSchedulerService } from '../job/job-scheduler.service';
import { NotificationService } from '../notification/notification.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { VolumeBackupSchedulerService } from '../volume-backup/volume-backup-scheduler.service';
import {
  assertSnapshot,
  NOT_RESTORED,
  Snapshot,
  SnapshotTable,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  tableOrder,
} from './database-snapshot';
import {
  INSTANCE_SETTINGS_ID,
  InstanceBackupSettings,
} from './instance-backup-settings.entity';
import {
  InstanceBackup,
  InstanceBackupTrigger,
} from './instance-backup.entity';

const HELPER_IMAGE = 'busybox:stable';
const DIR = '_instance';
/** Rows per INSERT; keeps each statement's JSON parameter reasonable. */
const BATCH = 500;
/** Uploads are held in memory (gzipped JSON of the panel DB is small). */
export const SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;

export interface RestoreReport {
  tables: number;
  rows: number;
  schemaVersion: string | null;
  /** ENCRYPTION_KEY differs from the one that wrote the snapshot, or other caveats. */
  warnings: string[];
}

/**
 * Snapshot & restore of the panel's own Postgres without pg_dump: every
 * entity table is read with `row_to_json` (ordered parents first) into one
 * gzipped JSON file in the backups volume, and written back with
 * `json_populate_recordset` inside one transaction. Encrypted columns stay
 * encrypted, so a restore elsewhere needs the same ENCRYPTION_KEY (and the
 * same JWT_SECRET for existing sessions/API tokens to keep working).
 */
@Injectable()
export class InstanceBackupService {
  private readonly logger = new Logger(InstanceBackupService.name);
  private restoring = false;

  constructor(
    @InjectRepository(InstanceBackup)
    readonly repo: Repository<InstanceBackup>,
    @InjectRepository(InstanceBackupSettings)
    private readonly settingsRepo: Repository<InstanceBackupSettings>,
    private readonly dataSource: DataSource,
    private readonly docker: DockerService,
    private readonly destinations: BackupDestinationService,
    private readonly files: BackupFilesService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly remote: RemoteDockerService,
    private readonly jobScheduler: JobSchedulerService,
    private readonly backupScheduler: BackupSchedulerService,
    private readonly volumeScheduler: VolumeBackupSchedulerService,
  ) {}

  /** `DataSource.query` is `any`-typed; every raw statement goes through here. */
  private async rows<T>(
    sql: string,
    params?: unknown[],
    runner: {
      query: (sql: string, params?: unknown[]) => Promise<unknown>;
    } = this.dataSource,
  ): Promise<T[]> {
    return (await runner.query(sql, params)) as T[];
  }

  private async appliedMigrations(runner?: {
    query: (sql: string, params?: unknown[]) => Promise<unknown>;
  }): Promise<string[]> {
    return (
      await this.rows<{ name: string }>(
        'SELECT name FROM migrations ORDER BY id',
        undefined,
        runner,
      )
    ).map((r) => r.name);
  }

  async settings(): Promise<InstanceBackupSettings> {
    const row = await this.settingsRepo.findOne({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    return (
      row ??
      this.settingsRepo.create({
        id: INSTANCE_SETTINGS_ID,
        backupCron: null,
        backupKeep: 7,
        destinationId: null,
      })
    );
  }

  async saveSettings(
    patch: Partial<
      Pick<
        InstanceBackupSettings,
        'backupCron' | 'backupKeep' | 'destinationId'
      >
    >,
  ): Promise<InstanceBackupSettings> {
    if (patch.destinationId)
      await this.destinations.findOrFail(patch.destinationId);
    const row = await this.settings();
    return this.settingsRepo.save(this.settingsRepo.merge(row, patch));
  }

  async findOrFail(id: string): Promise<InstanceBackup> {
    const b = await this.repo.findOne({ where: { id } });
    if (!b) throw new NotFoundException('Backup not found');
    return b;
  }

  /** Reads every table into a Snapshot (in memory). */
  async dump(): Promise<Snapshot> {
    const order = tableOrder(this.dataSource.entityMetadatas);
    const migrations = await this.appliedMigrations();
    const tables: SnapshotTable[] = [];
    for (const name of order) {
      const rows = await this.rows<{ r: Record<string, unknown> }>(
        `SELECT row_to_json(t) AS r FROM "${name}" t`,
      );
      tables.push({ name, rows: rows.map((x) => x.r) });
    }
    return {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      migrations,
      tables,
    };
  }

  /** Dumps, writes the file (and the S3 copy), records the row; never throws. */
  async backup(trigger: InstanceBackupTrigger): Promise<InstanceBackup> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${DIR}/${stamp}.json.gz`;
    const settings = await this.settings();
    const row = this.repo.create({
      filename,
      status: 'success',
      trigger,
      rowCount: 0,
      schemaVersion: null,
      destinationId: null,
      remoteKey: null,
      sizeBytes: null,
      errorMessage: null,
    });
    try {
      const snapshot = await this.dump();
      row.rowCount = snapshot.tables.reduce((n, t) => n + t.rows.length, 0);
      row.schemaVersion = snapshot.migrations.at(-1) ?? null;
      const gz = gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
      row.sizeBytes = String(gz.length);
      await this.writeFile(filename, gz);
      if (settings.destinationId) {
        row.destinationId = settings.destinationId;
        row.remoteKey = await this.destinations
          .upload(settings.destinationId, filename)
          .catch((err: unknown) => {
            throw new Error(
              `Upload to destination failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
    } catch (err) {
      row.status = 'failed';
      row.errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Instance backup failed: ${row.errorMessage}`);
    }
    const saved = await this.repo.save(row);
    if (saved.status === 'failed') this.notifyFailure(saved);
    return saved;
  }

  /** Restores from a stored backup (pulled back from S3 when the local file is gone). */
  async restore(backup: InstanceBackup): Promise<RestoreReport> {
    if (backup.status !== 'success') {
      throw new BadRequestException('Only successful backups can be restored');
    }
    await this.files.ensureLocal(backup);
    const gz = await this.readFile(backup.filename);
    return this.restoreFromBuffer(gz);
  }

  /** Restores from an uploaded `.json.gz` (new server, nothing in the DB yet). */
  async restoreFromBuffer(gz: Buffer): Promise<RestoreReport> {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(gunzipSync(gz).toString('utf8'));
      assertSnapshot(snapshot);
    } catch (err) {
      throw new BadRequestException(
        `Not an instance backup: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (this.restoring) {
      throw new BadRequestException('A restore is already running');
    }
    this.restoring = true;
    try {
      return await this.apply(snapshot);
    } finally {
      this.restoring = false;
    }
  }

  private async apply(snapshot: Snapshot): Promise<RestoreReport> {
    const order = tableOrder(this.dataSource.entityMetadatas);
    const migrations = await this.appliedMigrations();
    const mine = [...migrations].sort().join('\n');
    const theirs = [...snapshot.migrations].sort().join('\n');
    if (mine !== theirs) {
      throw new BadRequestException(
        `Schema mismatch: the backup was taken at migration "${snapshot.migrations.at(-1) ?? '?'}", ` +
          `this instance is at "${migrations.at(-1) ?? '?'}". Restore on the same aoox version.`,
      );
    }
    const byName = new Map(snapshot.tables.map((t) => [t.name, t.rows]));
    const restorable = order.filter((t) => !NOT_RESTORED.has(t));
    const unknown = [...byName.keys()].filter((t) => !order.includes(t));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown tables in backup: ${unknown.join(', ')}`,
      );
    }
    // This server's own backup rows survive (merged with the snapshot's list).
    const ownBackups = (
      await this.rows<{ r: Record<string, unknown> }>(
        'SELECT row_to_json(t) AS r FROM "instance_backups" t',
      )
    ).map((x) => x.r);

    let rows = 0;
    await this.dataSource.transaction(async (em) => {
      for (const t of [...restorable].reverse()) {
        await em.query(`DELETE FROM "${t}"`);
      }
      for (const t of restorable) {
        const data = byName.get(t) ?? [];
        for (let i = 0; i < data.length; i += BATCH) {
          await em.query(
            `INSERT INTO "${t}" SELECT * FROM json_populate_recordset(NULL::"${t}", $1)`,
            [JSON.stringify(data.slice(i, i + BATCH))],
          );
        }
        rows += data.length;
      }
      if (ownBackups.length) {
        await em.query(
          `INSERT INTO "instance_backups" SELECT * FROM json_populate_recordset(NULL::"instance_backups", $1) ON CONFLICT (id) DO NOTHING`,
          [JSON.stringify(ownBackups)],
        );
      }
    });

    const warnings: string[] = [];
    if (!(await this.secretsReadable())) {
      warnings.push(
        'Encrypted secrets (registry/git/notification/database passwords) cannot be decrypted with this ENCRYPTION_KEY; set the key of the original instance and restart.',
      );
    }
    warnings.push(
      'Sessions and API tokens from the backup only work if JWT_SECRET is the same; users may need to sign in again.',
    );
    await this.reloadSchedulers();
    this.logger.warn(
      `Instance restored: ${rows} rows in ${restorable.length} tables`,
    );
    return {
      tables: restorable.length,
      rows,
      schemaVersion: snapshot.migrations.at(-1) ?? null,
      warnings,
    };
  }

  /** Tries one encrypted value from the restored data; true when none exist or it decrypts. */
  private async secretsReadable(): Promise<boolean> {
    const key = this.config.get<string>('ENCRYPTION_KEY') ?? '';
    const probes: Array<[table: string, column: string]> = [
      ['registries', 'password_encrypted'],
      ['git_credentials', 'token_encrypted'],
      ['managed_databases', 'password_encrypted'],
      ['notifications', 'config_encrypted'],
      ['backup_destinations', 'secret_access_key_encrypted'],
    ];
    for (const [table, column] of probes) {
      const rows = await this.rows<{ v: string }>(
        `SELECT "${column}" AS v FROM "${table}" WHERE "${column}" IS NOT NULL LIMIT 1`,
      );
      if (rows.length === 0) continue;
      try {
        decryptSecret(rows[0].v, key);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  /** Cron entries and cached SSH sessions describe the old rows; rebuild them from the new ones. */
  private async reloadSchedulers(): Promise<void> {
    await this.jobScheduler.reloadAll();
    await this.backupScheduler.reloadAll();
    await this.volumeScheduler.reloadAll();
    this.remote.forgetAll();
  }

  async download(
    backup: InstanceBackup,
    sink: NodeJS.WritableStream,
  ): Promise<void> {
    await this.files.ensureLocal(backup);
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

  async delete(backup: InstanceBackup): Promise<void> {
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
    await this.repo.remove(backup);
  }

  /** Deletes the oldest scheduled snapshots beyond `backupKeep` (manual ones are never pruned). */
  async prune(keep: number): Promise<number> {
    const old = await this.repo.find({
      where: { trigger: 'scheduled', status: 'success' },
      order: { createdAt: 'DESC' },
      skip: Math.max(keep, 1),
    });
    for (const b of old) await this.delete(b).catch(() => undefined);
    return old.length;
  }

  /** Writes bytes into the backups volume through a stopped busybox (archive API, no exec). */
  private async writeFile(filename: string, content: Buffer): Promise<void> {
    await this.docker.ensureImage(HELPER_IMAGE);
    await this.docker.engine.createVolume(BACKUPS_VOLUME);
    const dir = `${MOUNT}/${DIR}`;
    // mkdir first (a separate short run), then drop the file in with putArchive.
    const code = await this.docker.runOnce({
      Image: HELPER_IMAGE,
      Cmd: ['mkdir', '-p', dir],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}`] },
    });
    if (code !== 0) throw new Error(`mkdir ${dir} failed (exit ${code})`);
    const id = await this.docker.engine.createContainer({
      Image: HELPER_IMAGE,
      Cmd: ['true'],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}`] },
    });
    try {
      await this.docker.engine.putArchive(
        id,
        dir,
        tarFiles([[filename.slice(DIR.length + 1), content]]),
      );
    } finally {
      await this.docker.engine.removeContainer(id, true).catch(() => undefined);
    }
  }

  private async readFile(filename: string): Promise<Buffer> {
    await this.docker.ensureImage(HELPER_IMAGE);
    const id = await this.docker.engine.createContainer({
      Image: HELPER_IMAGE,
      Cmd: ['true'],
      Labels: composeLabels('backup-helper'),
      HostConfig: { Binds: [`${BACKUPS_VOLUME}:${MOUNT}:ro`] },
    });
    try {
      return await this.docker.engine.readFileFromContainer(
        id,
        `${MOUNT}/${filename}`,
      );
    } finally {
      await this.docker.engine.removeContainer(id, true).catch(() => undefined);
    }
  }

  private notifyFailure(backup: InstanceBackup): void {
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    void this.notifications
      .broadcast('backupFailure', {
        title: 'Instance backup failed',
        level: 'failure',
        fields: [
          ['Trigger', backup.trigger],
          ['Error', (backup.errorMessage ?? 'unknown').slice(0, 500)],
        ],
        url: origin ? `${origin}/settings` : undefined,
        data: {
          event: 'instance-backup.failure',
          backupId: backup.id,
          trigger: backup.trigger,
          error: backup.errorMessage,
        },
      })
      .catch((err) =>
        this.logger.warn(`Backup notification failed: ${String(err)}`),
      );
  }
}
