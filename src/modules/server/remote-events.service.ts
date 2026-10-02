import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { DockerEvent } from '../docker/docker-engine.client';
import { RemoteDockerService } from './remote-docker.service';
import { ServerService } from './server.service';

/** How often the set of servers is compared with the open streams. */
export const EVENTS_RECONCILE_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

export interface RemoteDieEvent {
  serverId: string;
  event: DockerEvent;
}

interface StreamState {
  /** Bumped on every (re)connect so callbacks of a replaced stream are ignored. */
  generation: number;
  abort: (() => void) | null;
  retryTimer: NodeJS.Timeout | null;
  backoffMs: number;
  connectedAt: number;
}

/**
 * The remote counterpart of DockerEventsService: one `GET /events` stream
 * (`die` of `aoox.component` containers) per server, through the same SSH
 * tunnel deploys use. Each stream reconnects with its own backoff, so a dead
 * server only retries itself. Streams follow the `servers` table (started for
 * new servers, stopped for deleted ones) and restart when a server's session
 * is dropped (credentials edited, `forget`).
 */
@Injectable()
export class RemoteEventsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RemoteEventsService.name);
  private readonly emitter = new EventEmitter();
  private readonly streams = new Map<string, StreamState>();
  private timer: NodeJS.Timeout | null = null;
  private unsubscribeForget: (() => void) | null = null;
  private stopped = false;

  constructor(
    private readonly servers: ServerService,
    private readonly remote: RemoteDockerService,
  ) {
    this.emitter.setMaxListeners(0);
  }

  onApplicationBootstrap(): void {
    this.unsubscribeForget = this.remote.onForget((id) => this.restart(id));
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), EVENTS_RECONCILE_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.unsubscribeForget?.();
    for (const id of [...this.streams.keys()]) this.stop(id);
  }

  onContainerDie(cb: (e: RemoteDieEvent) => void): () => void {
    this.emitter.on('die', cb);
    return () => this.emitter.off('die', cb);
  }

  /** Server ids with an open (or retrying) stream; for tests and status. */
  watched(): string[] {
    return [...this.streams.keys()];
  }

  /** Starts streams for servers that have none, stops those of deleted servers. */
  async reconcile(): Promise<void> {
    if (this.stopped) return;
    let ids: string[];
    try {
      ids = (await this.servers.repo.find({ select: { id: true } })).map(
        (s) => s.id,
      );
    } catch (err) {
      this.logger.debug(`Server list unavailable: ${String(err)}`);
      return;
    }
    const wanted = new Set(ids);
    for (const id of ids) if (!this.streams.has(id)) this.start(id);
    for (const id of [...this.streams.keys()])
      if (!wanted.has(id)) this.stop(id);
  }

  private start(serverId: string): void {
    const state: StreamState = {
      generation: 0,
      abort: null,
      retryTimer: null,
      backoffMs: 1_000,
      connectedAt: 0,
    };
    this.streams.set(serverId, state);
    void this.connect(serverId, state);
  }

  private stop(serverId: string): void {
    const state = this.streams.get(serverId);
    if (!state) return;
    state.generation++;
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.abort?.();
    this.streams.delete(serverId);
  }

  /** The session changed: reconnect right away with a fresh backoff. */
  private restart(serverId: string): void {
    const state = this.streams.get(serverId);
    if (!state || this.stopped) return;
    state.generation++;
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = null;
    state.abort?.();
    state.abort = null;
    state.backoffMs = 1_000;
    void this.connect(serverId, state);
  }

  private async connect(serverId: string, state: StreamState): Promise<void> {
    if (this.stopped) return;
    const generation = ++state.generation;
    const current = () =>
      !this.stopped &&
      this.streams.get(serverId) === state &&
      state.generation === generation;
    const retry = (why: string) => {
      if (!current()) return;
      state.abort = null;
      // A stream that stayed up for a while was healthy: start over at 1 s.
      if (state.connectedAt && Date.now() - state.connectedAt > 30_000)
        state.backoffMs = 1_000;
      this.logger.debug(
        `Event stream of server ${serverId} ended (${why}); retry in ${state.backoffMs}ms`,
      );
      state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        void this.connect(serverId, state);
      }, state.backoffMs);
      state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
    };
    try {
      const handle = await this.remote.forServer(serverId);
      if (!current()) return;
      state.connectedAt = Date.now();
      state.abort = handle.engine.streamEvents(
        { type: ['container'], event: ['die'], label: ['aoox.component'] },
        (event) => {
          if (!current()) return;
          state.backoffMs = 1_000; // a delivered event proves the stream is healthy
          this.emitter.emit('die', {
            serverId,
            event,
          } satisfies RemoteDieEvent);
        },
        (err) => retry(err?.message ?? 'closed'),
      );
    } catch (err) {
      retry(err instanceof Error ? err.message : String(err));
    }
  }
}
