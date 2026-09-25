import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Application } from '../application/application.entity';
import { ApplicationService } from '../application/application.service';
import { VolumeBackupService } from './volume-backup.service';

/** One cron entry per application with `backupCron`; each tick backs up every volume mount. */
@Injectable()
export class VolumeBackupSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VolumeBackupSchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly applications: ApplicationService,
    private readonly backups: VolumeBackupService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const app of await this.applications.repo.find()) this.reschedule(app);
  }

  /** Drops every entry this scheduler owns and registers again from the DB (after an instance restore). */
  async reloadAll(): Promise<void> {
    for (const name of this.registry.getCronJobs().keys()) {
      if (name.startsWith('volume-backup:')) this.registry.deleteCronJob(name);
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

  reschedule(app: Application): void {
    const name = `volume-backup:${app.id}`;
    if (this.registry.doesExist('cron', name))
      this.registry.deleteCronJob(name);
    if (!app.backupCron) return;
    const job = new CronJob(app.backupCron, () => void this.run(app.id));
    this.registry.addCronJob(name, job);
    job.start();
    this.logger.log(
      `Scheduled volume backups for ${app.appName}: ${app.backupCron} (keep ${app.backupKeep})`,
    );
  }

  private async run(applicationId: string): Promise<void> {
    const app = await this.applications.repo.findOne({
      where: { id: applicationId },
    });
    if (!app) return;
    for (const mount of await this.backups.volumeMounts(app)) {
      const b = await this.backups.backup(app, mount, 'scheduled');
      if (b.status === 'success') {
        const pruned = await this.backups.prune(app, mount);
        if (pruned) {
          this.logger.log(
            `Pruned ${pruned} old backup(s) of ${app.appName}/${mount.name}`,
          );
        }
      }
    }
  }
}
