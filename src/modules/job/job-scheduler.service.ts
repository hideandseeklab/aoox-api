import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { JobRunnerService } from './job-runner.service';
import { Job } from './job.entity';
import { JobService } from './job.service';

/** One cron entry per enabled job with a schedule (same pattern as backups). */
@Injectable()
export class JobSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobSchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly jobs: JobService,
    private readonly runner: JobRunnerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const job of await this.jobs.repo.find()) this.reschedule(job);
  }

  /** Drops every entry this scheduler owns and registers again from the DB (after an instance restore). */
  async reloadAll(): Promise<void> {
    for (const name of this.registry.getCronJobs().keys()) {
      if (name.startsWith('job:')) this.registry.deleteCronJob(name);
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

  reschedule(job: Job): void {
    const name = `job:${job.id}`;
    if (this.registry.doesExist('cron', name))
      this.registry.deleteCronJob(name);
    if (!job.cron || !job.enabled) return;
    const cron = new CronJob(job.cron, () => void this.tick(job.id));
    this.registry.addCronJob(name, cron);
    cron.start();
    this.logger.log(`Scheduled job ${job.name}: ${job.cron}`);
  }

  unschedule(jobId: string): void {
    const name = `job:${jobId}`;
    if (this.registry.doesExist('cron', name))
      this.registry.deleteCronJob(name);
  }

  private async tick(jobId: string): Promise<void> {
    const job = await this.jobs.repo.findOne({ where: { id: jobId } });
    if (!job || !job.enabled) return;
    // Never overlap: a still-running instance simply skips this tick.
    if (this.runner.isActive(job.id)) {
      this.logger.warn(`Job ${job.name} still running; skipping tick`);
      return;
    }
    await this.runner.start(job, 'scheduled');
  }
}
