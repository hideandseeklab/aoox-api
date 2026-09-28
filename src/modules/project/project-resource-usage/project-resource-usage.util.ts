import {
  aggregateMetrics,
  ContainerMetrics,
} from '../../monitoring/container-metrics';
import { SAMPLE_INTERVAL_MS } from '../../monitoring/monitoring.service';

/** One point of a project's combined CPU/RAM/network reading. */
export interface ProjectResourceUsagePoint {
  at: string;
  /** Sum of every container's CPU % (can exceed 100 with several containers). */
  cpuPercent: number | null;
  memoryBytes: number;
  memoryLimitBytes: number;
  /** Rate, not the cumulative counter — see withRates() below. */
  netRxBytesPerSec: number | null;
  netTxBytesPerSec: number | null;
}

export interface ProjectResourceUsage {
  current: ProjectResourceUsagePoint | null;
  history: ProjectResourceUsagePoint[];
  /** How many containers (app + db + compose, across the project) fed this reading. */
  containers: number;
}

/** Narrow shape embedded in `list-projects`, where only the latest reading is useful. */
export interface ProjectResourceUsageSummary {
  cpuPercent: number | null;
  memoryBytes: number;
  netRxBytesPerSec: number | null;
  netTxBytesPerSec: number | null;
}

/**
 * Combines every container a project owns (application + database + compose,
 * swarm tasks already flattened by the caller) into one series, the same way
 * `aggregateMetrics` already sums a swarm service's tasks or a compose
 * stack's services. `ContainerMetrics.netRxBytes`/`netTxBytes` are cumulative
 * since each container started, which is meaningless once summed across
 * containers with different start times — so this also converts the summed
 * counter into a bytes/sec rate from consecutive sampler ticks, the only
 * project-relevant network figure. Pure, unit-tested.
 */
export function buildProjectUsage(
  series: Array<{ current: ContainerMetrics; history: ContainerMetrics[] }>,
): ProjectResourceUsage | null {
  const combined = aggregateMetrics(series, SAMPLE_INTERVAL_MS);
  if (!combined) return null;
  const history = withRates(combined.history);
  return {
    current: history.at(-1) ?? null,
    history,
    containers: series.length,
  };
}

export function toResourceUsageSummary(
  point: ProjectResourceUsagePoint | null,
): ProjectResourceUsageSummary | null {
  if (!point) return null;
  return {
    cpuPercent: point.cpuPercent,
    memoryBytes: point.memoryBytes,
    netRxBytesPerSec: point.netRxBytesPerSec,
    netTxBytesPerSec: point.netTxBytesPerSec,
  };
}

/**
 * A container leaving the sum between two ticks (deployed/stopped) makes the
 * summed cumulative counter dip — clamped to 0 rather than reported negative,
 * since "someone stopped" isn't a real download.
 */
function withRates(points: ContainerMetrics[]): ProjectResourceUsagePoint[] {
  return points.map((p, i) => {
    const prev = points[i - 1];
    const elapsedMs = prev ? Date.parse(p.at) - Date.parse(prev.at) : 0;
    const rate = (curBytes: number, prevBytes: number): number | null =>
      prev && elapsedMs > 0
        ? Math.max(0, Math.round(((curBytes - prevBytes) / elapsedMs) * 1000))
        : null;
    return {
      at: p.at,
      cpuPercent: p.cpuPercent,
      memoryBytes: p.memoryBytes,
      memoryLimitBytes: p.memoryLimitBytes,
      netRxBytesPerSec: prev ? rate(p.netRxBytes, prev.netRxBytes) : null,
      netTxBytesPerSec: prev ? rate(p.netTxBytes, prev.netTxBytes) : null,
    };
  });
}
