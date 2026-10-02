import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DockerEvent } from '../docker/docker-engine.client';
import { DockerEventsService } from '../docker/docker-events.service';
import { DockerService } from '../docker/docker.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { RemoteEventsService } from '../server/remote-events.service';
import { ServerService } from '../server/server.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { NotificationMessage } from '../notification/notification-sender';
import { NotificationService } from '../notification/notification.service';
import { ApplicationService } from './application.service';
import { SwarmDeployService } from './swarm-deploy.service';

/** Wait before judging a `die`: stop flows write `status = 'stopped'` after stopping. */
export const GRACE_MS = 5_000;
/** One notification per container per window, so a crash loop doesn't flood the channel. */
export const COOLDOWN_MS = 10 * 60_000;

/**
 * Turns Docker `die` events of managed containers into "container down"
 * notifications — but only for unexpected exits. After a grace period the
 * container is re-checked: gone (replaced by a deploy / deleted), owner row
 * `stopped` (user stop), or running again with exit code 0 (clean restart,
 * e.g. a redis restore) are all expected and skipped.
 *
 * Applications on remote servers go through the same checks: their `die`
 * events arrive from RemoteEventsService and the re-check asks that server's
 * daemon. The message names the server. A server that is itself unreachable
 * cannot be re-checked — that is reported by ServerHealthService instead.
 */
@Injectable()
export class ContainerDownNotifierService implements OnModuleInit {
  private readonly logger = new Logger(ContainerDownNotifierService.name);
  private readonly lastNotified = new Map<string, number>();

  constructor(
    private readonly events: DockerEventsService,
    private readonly docker: DockerService,
    private readonly applications: ApplicationService,
    private readonly databases: ManagedDatabaseService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly remoteEvents: RemoteEventsService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
  ) {}

  onModuleInit(): void {
    this.events.onContainerDie((event) => {
      setTimeout(() => {
        void this.handle(event).catch((err) =>
          this.logger.warn(`Container-down check failed: ${String(err)}`),
        );
      }, GRACE_MS);
    });
    this.remoteEvents.onContainerDie(({ serverId, event }) => {
      setTimeout(() => {
        void this.handle(event, serverId).catch((err) =>
          this.logger.warn(`Container-down check failed: ${String(err)}`),
        );
      }, GRACE_MS);
    });
  }

  async handle(event: DockerEvent, serverId?: string): Promise<void> {
    const attrs = event.Actor.Attributes;
    const exitCode = Number(attrs.exitCode ?? 0);
    const decision = await this.decide(
      event.Actor.ID,
      attrs,
      exitCode,
      serverId,
    );
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
    containerId: string,
    attrs: Record<string, string>,
    exitCode: number,
    serverId?: string,
  ): Promise<NotificationMessage | null> {
    const docker = serverId
      ? await this.remote.forServer(serverId)
      : this.docker;
    const serverName = serverId
      ? ((
          await this.servers.repo.findOne({
            where: { id: serverId },
            select: { id: true, name: true },
          })
        )?.name ?? null)
      : null;
    if (serverId && !serverName) return null; // server deleted meanwhile
    const onServer = serverName ? ` on server ${serverName}` : '';
    const inspect = await docker.engine.inspectContainer(containerId);
    if (!inspect) return null; // removed: deploy replaced it or it was deleted
    if (inspect.State.Running && exitCode === 0) return null; // clean restart

    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    const restarting =
      inspect.State.Running || inspect.State.Status === 'restarting';
    const component = attrs['aoox.component'];
    const name = attrs.name ?? containerId.slice(0, 12);

    let title: string;
    let url: string | undefined;
    const data: Record<string, unknown> = {
      event: 'container.down',
      container: name,
      exitCode,
      restarting,
      ...(serverId ? { serverId, server: serverName } : {}),
    };
    if (component === 'application') {
      const app = await this.applications.repo.findOne({
        where: { id: attrs['aoox.application'] },
        relations: { project: true },
      });
      if (!app || app.status === 'stopped') return null;
      // A container on the wrong server (app moved by a deploy) is not ours to report.
      if ((app.serverId ?? null) !== (serverId ?? null)) return null;
      // Swarm task: the daemon replaces failed tasks and retires old ones on
      // every rolling update, so only report when the service is short.
      let replicas: string | null = null;
      if (attrs['com.docker.swarm.service.name']) {
        const svc = await this.swarmDeploy.status(app).catch(() => null);
        if (!svc || svc.running >= svc.desired) return null;
        replicas = `${svc.running}/${svc.desired}`;
        Object.assign(data, { replicas });
      }
      title = replicas
        ? `Application task crashed: ${app.name} (${replicas} replicas)`
        : `Application ${restarting ? 'crashed' : 'went down'}: ${app.name}${onServer}`;
      url = origin ? `${origin}/applications/${app.id}` : undefined;
      Object.assign(data, {
        applicationId: app.id,
        application: app.name,
        project: app.project.name,
      });
    } else if (component === 'database' && !serverId) {
      const db = await this.databases.repo.findOne({
        where: { id: attrs['aoox.database'] },
      });
      if (!db || db.status === 'stopped') return null;
      title = `Database ${restarting ? 'crashed' : 'went down'}: ${db.name}`;
      url = origin ? `${origin}/databases/${db.id}` : undefined;
      Object.assign(data, { databaseId: db.id, database: db.name });
    } else {
      return null;
    }

    return {
      title,
      level: 'failure',
      fields: [
        ...(serverName ? [['Server', serverName] as [string, string]] : []),
        ['Container', name],
        ['Exit code', String(exitCode)],
        [
          'State',
          restarting ? 'restarting (restart policy)' : inspect.State.Status,
        ],
      ],
      url,
      data,
    };
  }
}
