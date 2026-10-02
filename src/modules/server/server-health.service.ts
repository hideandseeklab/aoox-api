import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../notification/notification.service';
import { RemoteDockerService } from './remote-docker.service';
import { Server, ServerHealthStatus } from './server.entity';
import { ServerService } from './server.service';
import { withTimeout } from './with-timeout';

/** A reachability probe that takes longer than this counts as a failure. */
export const HEALTH_TIMEOUT_MS = 12_000;
/** Failed checks in a row before a server is declared down. */
export const DOWN_AFTER_FAILURES = 2;
/** While a server stays down, at most one reminder per window. */
export const DOWN_REMINDER_MS = 60 * 60_000;

/**
 * Every minute asks each remote server's Docker daemon (through the same SSH
 * tunnel deploys use) for its running managed containers: the answer proves
 * the server, SSH and Docker are all up, and its length is the "monitored
 * containers" count shown in the server list. Probes run in parallel and
 * each has its own timeout, so one dead server never delays the others.
 *
 * The result lives on the `servers` row (`health_*`), which is what the web
 * reads — opening the page makes no call to any server. `down` needs two
 * failed checks in a row (a flaky link should not page anyone), is announced
 * once, reminded at most hourly while it lasts, and a single "reachable
 * again" message follows on recovery. Both use the `serverDown` event (one
 * toggle), told apart by level. A first check of a never-checked server that
 * succeeds only marks it `up`: nothing to announce.
 */
@Injectable()
export class ServerHealthService {
  private readonly logger = new Logger(ServerHealthService.name);
  private readonly failures = new Map<string, number>();
  private readonly lastDownNotice = new Map<string, number>();
  private running = false;

  constructor(
    private readonly servers: ServerService,
    private readonly remote: RemoteDockerService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.running) return; // a stuck round must not stack
    this.running = true;
    try {
      const rows = await this.servers.repo.find();
      const ids = new Set(rows.map((s) => s.id));
      for (const map of [this.failures, this.lastDownNotice]) {
        for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
      }
      await Promise.all(
        rows.map((s) =>
          this.check(s).catch((err) =>
            this.logger.warn(
              `Health check of ${s.name} failed: ${String(err)}`,
            ),
          ),
        ),
      );
    } finally {
      this.running = false;
    }
  }

  /** One probe + bookkeeping + notification for a server. Exported for tests. */
  async check(server: Server, now = new Date()): Promise<void> {
    let containers: number | null = null;
    let error: string | null = null;
    try {
      containers = await withTimeout(
        this.remote
          .forServer(server.id)
          .then((h) =>
            h.engine.listContainers({
              label: ['aoox.component'],
              status: ['running'],
            }),
          )
          .then((list) => list.length),
        HEALTH_TIMEOUT_MS,
        'Docker check',
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const prev = server.healthStatus;
    let next: ServerHealthStatus = prev;
    let failed = 0;
    if (error === null) {
      this.failures.delete(server.id);
      next = 'up';
    } else {
      failed = (this.failures.get(server.id) ?? 0) + 1;
      this.failures.set(server.id, failed);
      if (failed >= DOWN_AFTER_FAILURES) next = 'down';
    }
    const changed = next !== prev;
    await this.servers.repo.update(server.id, {
      healthStatus: next,
      healthCheckedAt: now,
      healthError: error ? error.slice(0, 500) : null,
      ...(containers !== null ? { monitoredContainers: containers } : {}),
      ...(changed || !server.healthChangedAt ? { healthChangedAt: now } : {}),
    });

    if (next === 'down') {
      const last = this.lastDownNotice.get(server.id);
      if (prev !== 'down') {
        this.lastDownNotice.set(server.id, now.getTime());
        await this.announceDown(server, error ?? '', failed, false, now);
      } else if (last === undefined) {
        // API restarted while it was already down: the earlier notice exists.
        this.lastDownNotice.set(server.id, now.getTime());
      } else if (now.getTime() - last >= DOWN_REMINDER_MS) {
        this.lastDownNotice.set(server.id, now.getTime());
        await this.announceDown(server, error ?? '', failed, true, now);
      }
    } else if (next === 'up' && prev === 'down') {
      this.lastDownNotice.delete(server.id);
      await this.announceRecovered(server, now);
    }
  }

  private url(): string | undefined {
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    return origin ? `${origin}/infra/servers` : undefined;
  }

  private async announceDown(
    server: Server,
    error: string,
    failed: number,
    reminder: boolean,
    now: Date,
  ): Promise<void> {
    const where = `${server.username}@${server.host}:${server.port}`;
    this.logger.warn(`Server ${server.name} is unreachable: ${error}`);
    await this.notifications.broadcast('serverDown', {
      title: `${reminder ? 'Server still unreachable' : 'Server unreachable'}: ${server.name}`,
      level: 'failure',
      fields: [
        ['Server', where],
        ['Error', error.slice(0, 200)],
        // On the first notice the row still says "up since"; the failure just began.
        ['Checked', now.toISOString()],
      ],
      url: this.url(),
      data: {
        event: 'server.down',
        serverId: server.id,
        server: server.name,
        host: server.host,
        error: error.slice(0, 200),
        failedChecks: failed,
        reminder,
      },
    });
  }

  private async announceRecovered(server: Server, now: Date): Promise<void> {
    const downMs = server.healthChangedAt
      ? now.getTime() - server.healthChangedAt.getTime()
      : null;
    const duration = downMs === null ? 'unknown' : formatDuration(downMs);
    await this.notifications.broadcast('serverDown', {
      title: `Server reachable again: ${server.name}`,
      level: 'success',
      fields: [
        ['Server', `${server.username}@${server.host}:${server.port}`],
        ['Down for', duration],
      ],
      url: this.url(),
      data: {
        event: 'server.recovered',
        serverId: server.id,
        server: server.name,
        downSeconds: downMs === null ? null : Math.round(downMs / 1000),
      },
    });
  }
}

/** "3m", "2h 5m" — for a down time, where seconds are noise. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  return `${h}h ${minutes % 60}m`;
}
