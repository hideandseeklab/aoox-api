import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DockerEvent } from '../docker/docker-engine.client';
import { DockerEventsService } from '../docker/docker-events.service';
import { DockerService } from '../docker/docker.service';
import { NotificationMessage } from '../notification/notification-sender';
import { NotificationService } from '../notification/notification.service';
import { COMPOSE_PROJECT_PREFIX } from '../monitoring/monitoring.service';
import { ComposeRunnerService } from './compose-runner.service';
import { ComposeService } from './compose.service';

/** Wait before judging a `die`, like the application notifier. */
export const GRACE_MS = 5_000;
/** One notification per container per window, so a crash loop cannot flood. */
export const COOLDOWN_MS = 10 * 60_000;

/**
 * "Container down" for stack services. Lives here rather than in the
 * application notifier because ComposeModule already imports
 * ApplicationModule — the other direction would be a cycle.
 *
 * A deploy recreates every container of the stack, and `up -d --build` can
 * take minutes between the first `die` and the last start, so a run in
 * flight silences the whole stack: unlike a single application, the grace
 * period cannot cover it.
 */
@Injectable()
export class ComposeDownNotifierService implements OnModuleInit {
  private readonly logger = new Logger(ComposeDownNotifierService.name);
  private readonly lastNotified = new Map<string, number>();

  constructor(
    private readonly events: DockerEventsService,
    private readonly docker: DockerService,
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.events.onContainerDie((event) => {
      const project =
        event.Actor.Attributes['com.docker.compose.project'] ?? '';
      if (!project.startsWith(COMPOSE_PROJECT_PREFIX)) return;
      setTimeout(() => {
        void this.handle(event).catch((err) =>
          this.logger.warn(`Stack-down check failed: ${String(err)}`),
        );
      }, GRACE_MS);
    });
  }

  async handle(event: DockerEvent): Promise<void> {
    const decision = await this.decide(event);
    if (!decision) return;

    const now = Date.now();
    const last = this.lastNotified.get(event.Actor.ID) ?? 0;
    if (now - last < COOLDOWN_MS) return;
    this.lastNotified.set(event.Actor.ID, now);

    this.logger.warn(decision.title);
    await this.notifications.broadcast('containerDown', decision);
  }

  /** Returns the message to send, or null when the exit was expected. */
  private async decide(
    event: DockerEvent,
  ): Promise<NotificationMessage | null> {
    const attrs = event.Actor.Attributes;
    const exitCode = Number(attrs.exitCode ?? 0);
    const project = attrs['com.docker.compose.project'] ?? '';
    const slug = project.slice(COMPOSE_PROJECT_PREFIX.length);
    const app = await this.compose.repo.findOne({
      where: { slug },
      relations: { project: true },
    });
    if (!app) return null; // some other project that happens to share the prefix
    // Deploy/stop/down all take containers away on purpose.
    if (this.runner.isActive(app.id)) return null;
    if (app.status !== 'running') return null;

    const inspect = await this.docker.engine.inspectContainer(event.Actor.ID);
    if (!inspect) return null; // removed: recreated by a deploy or torn down
    if (inspect.State.Running && exitCode === 0) return null; // clean restart

    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    const restarting =
      inspect.State.Running || inspect.State.Status === 'restarting';
    const service = attrs['com.docker.compose.service'] ?? '';
    const name = attrs.name ?? event.Actor.ID.slice(0, 12);
    return {
      title: `Stack service ${restarting ? 'crashed' : 'went down'}: ${app.name} (${service})`,
      level: 'failure',
      fields: [
        ['Stack', app.name],
        ['Service', service],
        ['Container', name],
        ['Exit code', String(exitCode)],
        [
          'State',
          restarting ? 'restarting (restart policy)' : inspect.State.Status,
        ],
      ],
      url: origin ? `${origin}/compose/${app.id}` : undefined,
      data: {
        event: 'compose.container.down',
        composeAppId: app.id,
        stack: app.name,
        service,
        container: name,
        exitCode,
        restarting,
      },
    };
  }
}
