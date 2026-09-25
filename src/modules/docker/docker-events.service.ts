import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { DockerEvent } from './docker-engine.client';
import { DockerService } from './docker.service';

/**
 * Only containers created by aoox carry this label. Filtering by the
 * key alone is deliberate: several `label` values in one Docker filter are
 * AND-ed, not OR-ed, so consumers pick the components they care about.
 */
const MANAGED_LABEL = 'aoox.component';

/**
 * Compose stacks the platform runs: their containers are created by the
 * compose CLI and carry its labels, not ours. Watching this label means a
 * second stream (several `label` values in one filter are AND-ed) that also
 * sees unrelated projects on the host — consumers match the project name.
 * Events already covered by the first stream are dropped here.
 */
const COMPOSE_LABEL = 'com.docker.compose.project';

/**
 * Keeps one `GET /events` stream open for `die` events of managed
 * containers, reconnecting with backoff when the daemon restarts or the
 * socket drops. Consumers subscribe with `onContainerDie`; the emitter is
 * in-process (single API instance, like DeploymentEventsService).
 */
@Injectable()
export class DockerEventsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DockerEventsService.name);
  private readonly emitter = new EventEmitter();
  private readonly streams: StreamState[] = [
    { label: MANAGED_LABEL, abort: null, retryTimer: null, backoffMs: 1_000 },
    { label: COMPOSE_LABEL, abort: null, retryTimer: null, backoffMs: 1_000 },
  ];
  private stopped = false;

  constructor(private readonly docker: DockerService) {
    this.emitter.setMaxListeners(0);
  }

  onApplicationBootstrap(): void {
    for (const stream of this.streams) this.connect(stream);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    for (const stream of this.streams) {
      if (stream.retryTimer) clearTimeout(stream.retryTimer);
      stream.abort?.();
    }
  }

  onContainerDie(cb: (event: DockerEvent) => void): () => void {
    this.emitter.on('die', cb);
    return () => this.emitter.off('die', cb);
  }

  private connect(stream: StreamState): void {
    if (this.stopped) return;
    stream.abort = this.docker.engine.streamEvents(
      {
        type: ['container'],
        event: ['die'],
        label: [stream.label],
      },
      (event) => {
        stream.backoffMs = 1_000; // a delivered event proves the stream is healthy
        // Our own containers carry both labels (composeLabels() puts them in
        // one Docker Desktop group), so the compose stream would report them
        // a second time.
        if (
          stream.label === COMPOSE_LABEL &&
          event.Actor.Attributes[MANAGED_LABEL]
        ) {
          return;
        }
        this.emitter.emit('die', event);
      },
      (err) => {
        stream.abort = null;
        if (this.stopped) return;
        // Quiet at debug level: Docker being down in dev is normal.
        this.logger.debug(
          `Event stream ${stream.label} ended (${err?.message ?? 'closed'}); retry in ${stream.backoffMs}ms`,
        );
        stream.retryTimer = setTimeout(
          () => this.connect(stream),
          stream.backoffMs,
        );
        stream.backoffMs = Math.min(stream.backoffMs * 2, 60_000);
      },
    );
  }
}

/** One `GET /events` connection with its own reconnect backoff. */
interface StreamState {
  label: string;
  abort: (() => void) | null;
  retryTimer: NodeJS.Timeout | null;
  backoffMs: number;
}
