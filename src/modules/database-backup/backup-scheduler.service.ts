import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { DatabaseBackupService } from './database-backup.service';

/**
 * Registers one cron job per database with `backupCron` set, using
 * @nestjs/schedule's SchedulerRegistry (https://docs.nestjs.com/techniques/task-scheduling).
 * Single API instance assumed.
 */
@Injectable()
export class BackupSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackupSchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly databases: ManagedDatabaseService,
    private readonly backups: DatabaseBackupService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const dbs = await this.databases.repo.find();
    for (const db of dbs) this.reschedule(db);
  }

  /** Drops every entry this scheduler owns and registers again from the DB (after an instance restore). */
  async reloadAll(): Promise<void> {
    for (const name of this.registry.getCronJobs().keys()) {
      if (name.startsWith('backup:')) this.registry.deleteCronJob(name);
    }
    await this.onApplicationBootstrap();
  }

  static isValidCron(expr: string): boolean {
    try {
      new CronJob(expr, () => undefined);
      return true;
    } catch {
      return false;
    }
  }

  /** Replaces (or removes) the job for a database after its schedule changed. */
  reschedule(db: ManagedDatabase): void {
    const name = `backup:${db.id}`;
    if (this.registry.doesExist('cron', name))
      this.registry.deleteCronJob(name);
    if (!db.backupCron) return;
    const job = new CronJob(db.backupCron, () => void this.run(db.id));
    this.registry.addCronJob(name, job);
    job.start();
    this.logger.log(
      `Scheduled backups for ${db.slug}: ${db.backupCron} (keep ${db.backupKeep})`,
    );
  }

  private async run(databaseId: string): Promise<void> {
    const db = await this.databases.repo.findOne({ where: { id: databaseId } });
    if (!db || db.status !== 'running') return;
    const b = await this.backups.backup(db, 'scheduled');
    if (b.status === 'success') {
      const pruned = await this.backups.prune(db);
      if (pruned)
        this.logger.log(`Pruned ${pruned} old backup(s) of ${db.slug}`);
    }
  }
}
