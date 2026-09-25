import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApplicationService } from './application.service';
import { Application } from './application.entity';
import { DeployApplicationService } from './deploy-application/deploy-application.service';
import { ImageDigestService } from './image-digest.service';

export interface ImageCheckResult {
  /** Digest the registry serves now (null when the reference pins a digest). */
  remoteDigest: string | null;
  /** Digest deployed before this check. */
  previousDigest: string | null;
  changed: boolean;
  /** Set when a deployment was queued. */
  deploymentId: string | null;
  /** First check for this app: digest recorded, nothing deployed. */
  baseline: boolean;
}

/**
 * Watchtower-style auto-update for image-sourced apps: every minute, apps
 * with `autoUpdate` whose interval elapsed get their tag's digest compared
 * with the deployed one; a change queues a normal deployment (which pulls
 * and replaces the container with the usual health check / blue-green).
 */
@Injectable()
export class ImageUpdateWatcherService {
  private readonly logger = new Logger(ImageUpdateWatcherService.name);
  private running = false;

  constructor(
    private readonly applications: ApplicationService,
    private readonly digests: ImageDigestService,
    private readonly deploy: DeployApplicationService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const apps = await this.applications.repo.find({
        where: { sourceType: 'image', autoUpdate: true, status: 'running' },
      });
      const now = Date.now();
      for (const app of apps) {
        const due =
          !app.imageCheckedAt ||
          now - app.imageCheckedAt.getTime() >=
            app.autoUpdateIntervalMinutes * 60_000;
        if (!due) continue;
        try {
          const r = await this.check(app, true);
          if (r.deploymentId) {
            this.logger.log(
              `Image of ${app.name} changed (${r.remoteDigest?.slice(7, 19)}); deployment ${r.deploymentId} queued`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Image check for ${app.name} failed: ${String(err)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * One check; `deploy` = queue a deployment when the digest changed. A
   * check that fails (registry down) still stamps `imageCheckedAt` so one
   * broken registry cannot make every tick retry it.
   */
  async check(app: Application, deploy: boolean): Promise<ImageCheckResult> {
    const previousDigest = app.imageDigest;
    app.imageCheckedAt = new Date();
    let remoteDigest: string | null;
    try {
      remoteDigest = await this.digests.remoteDigest(app);
    } catch (err) {
      await this.applications.repo.update(app.id, {
        imageCheckedAt: app.imageCheckedAt,
      });
      throw err;
    }
    const baseline = !previousDigest && !!remoteDigest;
    const changed =
      !!remoteDigest && !!previousDigest && remoteDigest !== previousDigest;
    let deploymentId: string | null = null;
    if (baseline || (changed && !deploy)) {
      // A baseline is recorded without deploying; a manual check only reports.
      await this.applications.repo.update(app.id, {
        imageCheckedAt: app.imageCheckedAt,
        ...(baseline ? { imageDigest: remoteDigest } : {}),
      });
      if (baseline) app.imageDigest = remoteDigest;
    } else {
      await this.applications.repo.update(app.id, {
        imageCheckedAt: app.imageCheckedAt,
      });
    }
    if (changed && deploy) {
      try {
        const d = await this.deploy.queue(app, 'auto-update');
        deploymentId = d.id;
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        // A deployment is already running; the next tick compares again.
      }
    }
    return { remoteDigest, previousDigest, changed, deploymentId, baseline };
  }
}
