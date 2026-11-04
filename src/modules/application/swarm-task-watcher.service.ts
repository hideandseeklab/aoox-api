import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../notification/notification.service';
import { ApplicationService } from './application.service';
import { ServiceStatus, SwarmDeployService } from './swarm-deploy.service';

/** At most one alert per app per 10 minutes, like container-down. */
const COOLDOWN_MS = 10 * 60_000;
/** Task states that mean the task died (a rolling update ends old tasks as `shutdown`, never these). */
const DEAD_STATES = new Set(['failed', 'rejected', 'orphaned']);

type Task = ServiceStatus['tasks'][number];

/**
 * Tasks of swarm services that die on OTHER nodes. The container-down
 * notifier only sees `die` events of the local daemon, and swarm workers are
 * not aoox servers (no SSH, no event stream), so a crash there used to pass
 * silently. The manager's Engine API lists every task with its node and
 * state, so every 30 seconds we look at each service-mode app for task ids
 * that are newly failed/rejected/orphaned.
 *
 * - First sight of an app only records what already failed (a boot must not
 *   alert on history).
 * - Tasks on the local node (or without a node) are skipped: their `die`
 *   events already notify, so no duplicates.
 * - One `containerDown` message per app per tick (variant `task`, plus the
 *   node), then a 10-minute cooldown per app.
 */
@Injectable()
export class SwarmTaskWatcherService {
  private readonly logger = new Logger(SwarmTaskWatcherService.name);
  /** Dead task ids already seen, per application. */
  private readonly seen = new Map<string, Set<string>>();
  private readonly notified = new Map<string, number>();

  constructor(
    private readonly applications: ApplicationService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    const apps = await this.applications.repo.find({
      where: { deployMode: 'service' },
      relations: { project: true },
    });
    const live = new Set(apps.map((a) => a.id));
    for (const id of [...this.seen.keys()]) {
      if (!live.has(id)) {
        this.seen.delete(id);
        this.notified.delete(id);
      }
    }
    const now = Date.now();
    for (const app of apps) {
      const svc = await this.swarmDeploy.status(app).catch(() => null);
      if (!svc) continue;
      const dead = svc.tasks.filter((t) => DEAD_STATES.has(t.state));
      const known = this.seen.get(app.id);
      this.seen.set(app.id, new Set(dead.map((t) => t.id)));
      if (!known) continue; // baseline
      const fresh = dead.filter(
        (t) => !known.has(t.id) && !t.local && app.status !== 'stopped',
      );
      if (fresh.length === 0) continue;
      if (now - (this.notified.get(app.id) ?? 0) < COOLDOWN_MS) continue;
      this.notified.set(app.id, now);
      await this.notify(app, svc, fresh);
    }
  }

  private async notify(
    app: { id: string; name: string; project: { name: string } },
    svc: ServiceStatus,
    fresh: Task[],
  ): Promise<void> {
    const task = fresh[0];
    const node = task.node ?? 'another node';
    const replicas = `${svc.running}/${svc.desired}`;
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    this.logger.warn(
      `Task of ${app.name} died on ${node} (${replicas} replicas)`,
    );
    await this.notifications
      .broadcast('containerDown', {
        title: `Application task crashed: ${app.name} (${replicas} replicas)`,
        level: 'failure',
        fields: [
          ['Application', app.name],
          ['Project', app.project.name],
          ['Node', node],
          [
            'Task',
            `#${task.slot ?? '?'} ${task.state}${task.error ? `: ${task.error}` : ''}`,
          ],
          ['Replicas', replicas],
        ],
        url: origin ? `${origin}/applications/${app.id}` : undefined,
        params: {
          variant: 'task',
          application: app.name,
          project: app.project.name,
          running: svc.running,
          desired: svc.desired,
          node,
        },
        data: {
          event: 'container.down',
          applicationId: app.id,
          application: app.name,
          project: app.project.name,
          node,
          replicas,
          tasks: fresh.length,
        },
      })
      .catch((err) =>
        this.logger.warn(`Task notification failed: ${String(err)}`),
      );
  }
}
