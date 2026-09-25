import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InstanceBackupSettings } from './instance-backup-settings.entity';
import { InstanceBackupService } from './instance-backup.service';

const NAME = 'instance-backup';

/** One cron entry for the instance snapshot (same pattern as the database backup scheduler). */
@Injectable()
export class InstanceBackupSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InstanceBackupSchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly backups: InstanceBackupService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.reschedule(await this.backups.settings());
  }

  reschedule(settings: InstanceBackupSettings): void {
    if (this.registry.doesExist('cron', NAME))
      this.registry.deleteCronJob(NAME);
    if (!settings.backupCron) return;
    const job = new CronJob(settings.backupCron, () => void this.run());
    this.registry.addCronJob(NAME, job);
    job.start();
    this.logger.log(
      `Scheduled instance backups: ${settings.backupCron} (keep ${settings.backupKeep})`,
    );
  }

  private async run(): Promise<void> {
    const b = await this.backups.backup('scheduled');
    if (b.status === 'success') {
      const pruned = await this.backups.prune(
        (await this.backups.settings()).backupKeep,
      );
      if (pruned) this.logger.log(`Pruned ${pruned} old instance backup(s)`);
    }
  }
}
