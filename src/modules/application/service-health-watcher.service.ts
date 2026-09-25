import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../notification/notification.service';
import { ApplicationService } from './application.service';
import { SwarmDeployService } from './swarm-deploy.service';

/** One alert per app per half hour while it stays short. */
const COOLDOWN_MS = 30 * 60_000;

/**
 * Swarm services that stay below their replica count without any task
 * dying (image not pullable on a node, unsatisfiable constraint, tasks
 * stuck in `pending`) never trigger a container-die event, so the
 * container-down notifier is blind to them. Every 2 minutes: an app that
 * was short on two consecutive checks gets a `containerDown` notification.
 */
@Injectable()
export class ServiceHealthWatcherService {
  private readonly logger = new Logger(ServiceHealthWatcherService.name);
  private readonly shortSince = new Map<string, number>();
  private readonly notified = new Map<string, number>();

  constructor(
    private readonly applications: ApplicationService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/2 * * * *')
  async tick(): Promise<void> {
    const apps = await this.applications.repo.find({
      where: { deployMode: 'service', status: 'running' },
      relations: { project: true },
    });
    const now = Date.now();
    for (const app of apps) {
      const svc = await this.swarmDeploy.status(app).catch(() => null);
      const short = !!svc && svc.running < svc.desired;
      if (!short) {
        this.shortSince.delete(app.id);
        continue;
      }
      const since = this.shortSince.get(app.id);
      if (!since) {
        this.shortSince.set(app.id, now);
        continue;
      }
      if (now - (this.notified.get(app.id) ?? 0) < COOLDOWN_MS) continue;
      this.notified.set(app.id, now);
      const pending = svc.tasks.find(
        (t) => t.desiredState === 'running' && t.state !== 'running',
      );
      const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
      this.logger.warn(
        `Service ${app.name} short: ${svc.running}/${svc.desired}${pending?.error ? ` (${pending.error})` : ''}`,
      );
      await this.notifications
        .broadcast('containerDown', {
          title: `Service short of replicas: ${app.name} (${svc.running}/${svc.desired})`,
          level: 'failure',
          fields: [
            ['Application', app.name],
            ['Project', app.project.name],
            ['Replicas', `${svc.running}/${svc.desired}`],
            ['Since', new Date(since).toISOString()],
            ...(pending
              ? [
                  [
                    'Task',
                    `#${pending.slot ?? '?'} ${pending.state}${pending.node ? ` on ${pending.node}` : ''}${pending.error ? `: ${pending.error}` : ''}`,
                  ] as [string, string],
                ]
              : []),
          ],
          url: origin ? `${origin}/applications/${app.id}` : undefined,
          data: {
            event: 'service.short',
            applicationId: app.id,
            running: svc.running,
            desired: svc.desired,
            since: new Date(since).toISOString(),
          },
        })
        .catch((err) =>
          this.logger.warn(`Service-short notification failed: ${String(err)}`),
        );
    }
  }
}
