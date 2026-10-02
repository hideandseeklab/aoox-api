import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DockerEngineClient } from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { ServerService } from '../server/server.service';
import { withTimeout } from '../server/with-timeout';
import { computeMetrics, ContainerMetrics } from './container-metrics';

/** How often every managed container is sampled. */
export const SAMPLE_INTERVAL_MS = 15_000;
/**
 * Remote servers are sampled less often: every reading is two `stats` calls
 * per container through an SSH tunnel.
 */
export const REMOTE_SAMPLE_INTERVAL_MS = 30_000;
/** One server round must finish within this, or it is abandoned. */
export const REMOTE_CYCLE_TIMEOUT_MS = 25_000;
/** Containers of one server sampled at the same time. */
const REMOTE_CONCURRENCY = 3;
/** Gap between the two stats calls a CPU % needs. */
const CPU_WINDOW_MS = 1_000;
/** Points kept per container (1 hour at the sample interval). */
export const HISTORY_POINTS = 240;
/**
 * Compose stacks the platform runs: their containers are created by the
 * compose CLI, which sets its own labels and not `aoox.component`.
 * The project name is ours (`aoox-<slug>`), so it identifies them —
 * the dist stack's own project is plain `aoox` and is not matched.
 */
export const COMPOSE_PROJECT_PREFIX = 'aoox-';

export interface HostOverview {
  cpus: number;
  memoryTotalBytes: number;
  serverVersion: string;
  operatingSystem: string;
  containers: { total: number; running: number };
  images: number;
  /** Docker disk usage (bytes); the host filesystem itself is not visible from a container. */
  disk: {
    imagesBytes: number;
    containersBytes: number;
    volumesBytes: number;
    buildCacheBytes: number;
  };
  /** Sum of the latest sample of every managed container. */
  managed: { containers: number; memoryBytes: number; cpuPercent: number };
}

/**
 * Samples every aoox-managed container (`aoox.component` label)
 * in the background and keeps a short in-memory history per container, so
 * detail pages get the current reading plus a sparkline without waiting a
 * second for a CPU delta. Single API instance; history is lost on restart.
 */
@Injectable()
export class MonitoringService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MonitoringService.name);
  private readonly history = new Map<string, ContainerMetrics[]>();
  /**
   * Containers of remote servers, kept apart from `history`: the local sweep
   * deletes every id it does not list, and the host totals must not add
   * other machines' containers to this host's numbers. Docker ids are random
   * 256-bit values, so they cannot collide across daemons.
   */
  private readonly remoteHistory = new Map<string, ContainerMetrics[]>();
  private readonly remoteInfo = new Map<
    string,
    { serverId: string; labels: Record<string, string> }
  >();
  private readonly remoteByServer = new Map<string, Set<string>>();
  private readonly remoteRunning = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private remoteTimer: NodeJS.Timeout | null = null;
  private sampling = false;

  constructor(
    private readonly docker: DockerService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sampleAll(), SAMPLE_INTERVAL_MS);
    this.timer.unref();
    void this.sampleAll();
    this.remoteTimer = setInterval(
      () => void this.sampleRemote(),
      REMOTE_SAMPLE_INTERVAL_MS,
    );
    this.remoteTimer.unref();
    void this.sampleRemote();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.remoteTimer) clearInterval(this.remoteTimer);
  }

  /**
   * Every sampled container with its owner labels, for the rollup that
   * writes history to the database (see metric-retention.service.ts).
   */
  sampledContainers(): Array<{
    containerId: string;
    points: ContainerMetrics[];
  }> {
    return [...this.history, ...this.remoteHistory].map(
      ([containerId, points]) => ({ containerId, points }),
    );
  }

  /**
   * Containers currently sampled on remote servers with their labels, so the
   * rollups that resolve owners from `aoox.*` labels (retention, project
   * usage) see them without opening an SSH call of their own.
   */
  remoteContainers(): Array<{
    containerId: string;
    serverId: string;
    labels: Record<string, string>;
  }> {
    return [...this.remoteInfo].map(([containerId, v]) => ({
      containerId,
      ...v,
    }));
  }

  /** Latest reading + history for a container, or null when never sampled. */
  metricsFor(containerId: string): {
    current: ContainerMetrics;
    history: ContainerMetrics[];
  } | null {
    const points =
      this.history.get(containerId) ?? this.remoteHistory.get(containerId);
    if (!points?.length) return null;
    return { current: points[points.length - 1], history: points };
  }

  /** Takes two samples 1s apart and records the result. */
  async sampleContainer(
    containerId: string,
    engine: DockerEngineClient = this.docker.engine,
    store: Map<string, ContainerMetrics[]> = this.history,
  ): Promise<ContainerMetrics> {
    const first = await engine.containerStats(containerId);
    await new Promise((r) => setTimeout(r, CPU_WINDOW_MS));
    const second = await engine.containerStats(containerId);
    const metrics = computeMetrics(first, second);
    const points = store.get(containerId) ?? [];
    points.push(metrics);
    if (points.length > HISTORY_POINTS)
      points.splice(0, points.length - HISTORY_POINTS);
    store.set(containerId, points);
    return metrics;
  }

  /**
   * One sampling round per remote server. Rounds are started side by side and
   * never awaited together: a slow or dead server only keeps its own round
   * (capped by `REMOTE_CYCLE_TIMEOUT_MS`), and a round still running when the
   * next tick comes is left alone instead of stacked. Servers that were
   * deleted lose their readings here.
   */
  async sampleRemote(): Promise<void> {
    let ids: string[];
    try {
      ids = (await this.servers.repo.find({ select: { id: true } })).map(
        (s) => s.id,
      );
    } catch (err) {
      this.logger.debug(`Remote sampling skipped: ${String(err)}`);
      return;
    }
    const wanted = new Set(ids);
    for (const serverId of [...this.remoteByServer.keys()]) {
      if (!wanted.has(serverId)) this.forgetServer(serverId);
    }
    for (const serverId of ids) {
      if (this.remoteRunning.has(serverId)) continue;
      this.remoteRunning.add(serverId);
      void this.sampleServer(serverId)
        .catch((err) => {
          this.logger.debug(`Server ${serverId} not sampled: ${String(err)}`);
          // Stale numbers from a server we cannot reach are worse than none.
          this.dropServerReadings(serverId);
        })
        .finally(() => this.remoteRunning.delete(serverId));
    }
  }

  /** Samples every running managed container of one server (bounded parallelism). */
  async sampleServer(serverId: string): Promise<void> {
    await withTimeout(
      this.sampleServerUnbounded(serverId),
      REMOTE_CYCLE_TIMEOUT_MS,
      'Remote sampling',
    );
  }

  private async sampleServerUnbounded(serverId: string): Promise<void> {
    const handle = await this.remote.forServer(serverId);
    const containers = await handle.engine.listContainers({
      label: ['aoox.component'],
      status: ['running'],
    });
    const live = new Set(containers.map((c) => c.Id));
    for (const id of this.remoteByServer.get(serverId) ?? []) {
      if (!live.has(id)) this.dropContainer(id); // removed or stopped
    }
    this.remoteByServer.set(serverId, live);
    for (const c of containers)
      this.remoteInfo.set(c.Id, { serverId, labels: c.Labels ?? {} });
    const queue = [...containers];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const id = c.Id;
        await this.sampleContainer(id, handle.engine, this.remoteHistory).catch(
          (err) =>
            this.logger.debug(
              `stats ${c.Names[0]} on ${serverId}: ${String(err)}`,
            ),
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(REMOTE_CONCURRENCY, containers.length) },
        worker,
      ),
    );
  }

  /** A server is gone (deleted): its readings and labels go with it. */
  forgetServer(serverId: string): void {
    this.dropServerReadings(serverId);
    this.remoteByServer.delete(serverId);
  }

  private dropServerReadings(serverId: string): void {
    for (const id of this.remoteByServer.get(serverId) ?? []) {
      this.dropContainer(id);
    }
    this.remoteByServer.set(serverId, new Set());
  }

  private dropContainer(id: string): void {
    this.remoteHistory.delete(id);
    this.remoteInfo.delete(id);
  }

  async hostOverview(): Promise<HostOverview> {
    const [info, df] = await Promise.all([
      this.docker.engine.systemInfo(),
      this.docker.engine.systemDataUsage(),
    ]);
    return {
      cpus: info.NCPU,
      memoryTotalBytes: info.MemTotal,
      serverVersion: info.ServerVersion,
      operatingSystem: info.OperatingSystem,
      containers: { total: info.Containers, running: info.ContainersRunning },
      images: info.Images,
      disk: {
        imagesBytes: df.LayersSize,
        containersBytes: df.Containers.reduce((s, c) => s + (c.SizeRw ?? 0), 0),
        volumesBytes: df.Volumes.reduce(
          (s, v) => s + Math.max(0, v.UsageData?.Size ?? 0),
          0,
        ),
        buildCacheBytes: (df.BuildCache ?? []).reduce(
          (s, b) => s + (b.Shared ? 0 : b.Size),
          0,
        ),
      },
      managed: this.managedTotals(),
    };
  }

  /** Latest readings of every sampled container, summed. */
  managedTotals(): {
    containers: number;
    memoryBytes: number;
    cpuPercent: number;
  } {
    let memoryBytes = 0;
    let cpuPercent = 0;
    let containers = 0;
    for (const points of this.history.values()) {
      const last = points[points.length - 1];
      if (!last) continue;
      containers++;
      memoryBytes += last.memoryBytes;
      cpuPercent += last.cpuPercent ?? 0;
    }
    return {
      containers,
      memoryBytes,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
    };
  }

  private async sampleAll(): Promise<void> {
    if (this.sampling) return; // a slow daemon must not stack samplers
    this.sampling = true;
    try {
      const [managed, composed] = await Promise.all([
        this.docker.engine.listContainers({
          label: ['aoox.component'],
          status: ['running'],
        }),
        // Stack containers, which carry the compose label instead. Two calls
        // because several `label` values in one filter are AND-ed.
        this.docker.engine.listContainers({
          label: ['com.docker.compose.project'],
          status: ['running'],
        }),
      ]);
      const containers = [
        ...managed,
        ...composed.filter(
          (c) =>
            !c.Labels?.['aoox.component'] &&
            c.Labels?.['com.docker.compose.project']?.startsWith(
              COMPOSE_PROJECT_PREFIX,
            ),
        ),
      ];
      const live = new Set(containers.map((c) => c.Id));
      for (const id of this.history.keys()) {
        if (!live.has(id)) this.history.delete(id); // removed or stopped
      }
      await Promise.all(
        containers.map((c) =>
          this.sampleContainer(c.Id).catch((err) =>
            this.logger.debug(`stats ${c.Names[0]}: ${String(err)}`),
          ),
        ),
      );
    } catch (err) {
      // Docker down (dev) is routine; keep quiet.
      this.logger.debug(`Sampling skipped: ${String(err)}`);
    } finally {
      this.sampling = false;
    }
  }
}
