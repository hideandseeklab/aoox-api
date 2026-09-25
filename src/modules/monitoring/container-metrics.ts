import { ContainerStats } from '../docker/docker-engine.client';

/** One point-in-time reading of a container (all sizes in bytes). */
export interface ContainerMetrics {
  /** ISO timestamp of the sample. */
  at: string;
  /** Percent of one CPU (can exceed 100 on multi-core), null when not computable. */
  cpuPercent: number | null;
  /** Application memory: usage minus page cache, like `docker stats`. */
  memoryBytes: number;
  /** cgroup limit — the host's RAM when the container has no memory limit. */
  memoryLimitBytes: number;
  /** Cumulative bytes over all interfaces since the container started. */
  netRxBytes: number;
  netTxBytes: number;
}

/**
 * Computes metrics from two consecutive samples, the way `docker stats`
 * does: CPU % is the container's share of the delta in total system CPU time,
 * scaled by the number of online CPUs. Pure, so it is unit-tested without
 * Docker. `prev` may be the same snapshot as `cur` (first sample) → cpu null.
 */
export function computeMetrics(
  prev: ContainerStats,
  cur: ContainerStats,
): ContainerMetrics {
  const cpuDelta =
    cur.cpu_stats.cpu_usage.total_usage - prev.cpu_stats.cpu_usage.total_usage;
  const systemDelta =
    (cur.cpu_stats.system_cpu_usage ?? 0) -
    (prev.cpu_stats.system_cpu_usage ?? 0);
  const cpus =
    cur.cpu_stats.online_cpus ?? cur.cpu_stats.cpu_usage.percpu_usage?.length;
  const cpuPercent =
    systemDelta > 0 && cpuDelta >= 0 && cpus
      ? round((cpuDelta / systemDelta) * cpus * 100)
      : null;

  const usage = cur.memory_stats.usage ?? 0;
  const cache =
    cur.memory_stats.stats?.inactive_file ?? cur.memory_stats.stats?.cache ?? 0;

  let netRxBytes = 0;
  let netTxBytes = 0;
  for (const iface of Object.values(cur.networks ?? {})) {
    netRxBytes += iface.rx_bytes;
    netTxBytes += iface.tx_bytes;
  }

  return {
    at: cur.read,
    cpuPercent,
    memoryBytes: Math.max(0, usage - cache),
    memoryLimitBytes: cur.memory_stats.limit ?? 0,
    netRxBytes,
    netTxBytes,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sums the metrics of several containers (the tasks of a swarm service on
 * this node) into one series. `current` = the sum of every container's
 * latest sample; `history` buckets samples by `bucketMs` (the sampler tick)
 * and sums each bucket. CPU is null when any container has no reading.
 * Pure, unit-tested.
 */
export function aggregateMetrics(
  series: Array<{ current: ContainerMetrics; history: ContainerMetrics[] }>,
  bucketMs: number,
): { current: ContainerMetrics; history: ContainerMetrics[] } | null {
  if (series.length === 0) return null;
  const sum = (points: ContainerMetrics[]): ContainerMetrics => ({
    at: points.reduce((m, p) => (p.at > m ? p.at : m), points[0].at),
    cpuPercent: points.every((p) => p.cpuPercent !== null)
      ? points.reduce((n, p) => n + (p.cpuPercent ?? 0), 0)
      : null,
    memoryBytes: points.reduce((n, p) => n + p.memoryBytes, 0),
    memoryLimitBytes: points.reduce((n, p) => n + p.memoryLimitBytes, 0),
    netRxBytes: points.reduce((n, p) => n + p.netRxBytes, 0),
    netTxBytes: points.reduce((n, p) => n + p.netTxBytes, 0),
  });
  const buckets = new Map<number, ContainerMetrics[]>();
  for (const s of series) {
    for (const p of s.history) {
      const key = Math.floor(Date.parse(p.at) / bucketMs);
      buckets.set(key, [...(buckets.get(key) ?? []), p]);
    }
  }
  const history = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, points]) => sum(points));
  return { current: sum(series.map((s) => s.current)), history };
}
