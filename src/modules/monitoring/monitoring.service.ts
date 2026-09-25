import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DockerService } from '../docker/docker.service';
import { computeMetrics, ContainerMetrics } from './container-metrics';

/** How often every managed container is sampled. */
export const SAMPLE_INTERVAL_MS = 15_000;
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
  private timer: NodeJS.Timeout | null = null;
  private sampling = false;

  constructor(private readonly docker: DockerService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sampleAll(), SAMPLE_INTERVAL_MS);
    this.timer.unref();
    void this.sampleAll();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Every sampled container with its owner labels, for the rollup that
   * writes history to the database (see metric-retention.service.ts).
   */
  sampledContainers(): Array<{
    containerId: string;
    points: ContainerMetrics[];
  }> {
    return [...this.history].map(([containerId, points]) => ({
      containerId,
      points,
    }));
  }

  /** Latest reading + history for a container, or null when never sampled. */
  metricsFor(containerId: string): {
    current: ContainerMetrics;
    history: ContainerMetrics[];
  } | null {
    const points = this.history.get(containerId);
    if (!points?.length) return null;
    return { current: points[points.length - 1], history: points };
  }

  /** Takes two samples 1s apart and records the result. */
  async sampleContainer(containerId: string): Promise<ContainerMetrics> {
    const first = await this.docker.engine.containerStats(containerId);
    await new Promise((r) => setTimeout(r, CPU_WINDOW_MS));
    const second = await this.docker.engine.containerStats(containerId);
    const metrics = computeMetrics(first, second);
    const points = this.history.get(containerId) ?? [];
    points.push(metrics);
    if (points.length > HISTORY_POINTS)
      points.splice(0, points.length - HISTORY_POINTS);
    this.history.set(containerId, points);
    return metrics;
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
