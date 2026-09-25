import { ContainerStats } from '../docker/docker-engine.client';
import {
  aggregateMetrics,
  computeMetrics,
  ContainerMetrics,
} from './container-metrics';

function sample(over: Partial<ContainerStats> = {}): ContainerStats {
  return {
    read: '2026-01-01T00:00:01Z',
    cpu_stats: {
      cpu_usage: { total_usage: 2_000_000_000 },
      system_cpu_usage: 100_000_000_000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 1_000_000_000 },
      system_cpu_usage: 90_000_000_000,
    },
    memory_stats: {
      usage: 100 * 1024 * 1024,
      limit: 8 * 1024 * 1024 * 1024,
      stats: { inactive_file: 30 * 1024 * 1024 },
    },
    networks: {
      eth0: { rx_bytes: 1000, tx_bytes: 200 },
      eth1: { rx_bytes: 10, tx_bytes: 1 },
    },
    ...over,
  };
}

describe('computeMetrics', () => {
  it('computes CPU % from the delta between two samples, scaled by online CPUs', () => {
    const prev = sample({
      cpu_stats: {
        cpu_usage: { total_usage: 1_000_000_000 },
        system_cpu_usage: 90_000_000_000,
        online_cpus: 4,
      },
    });
    const cur = sample();
    // (1e9 / 1e10) * 4 * 100 = 40%
    expect(computeMetrics(prev, cur).cpuPercent).toBe(40);
  });

  it('reports null CPU when both samples are the same snapshot (stream=false quirk)', () => {
    const s = sample();
    expect(computeMetrics(s, s).cpuPercent).toBeNull();
  });

  it('subtracts page cache from memory and sums all interfaces', () => {
    const m = computeMetrics(sample(), sample());
    expect(m.memoryBytes).toBe(70 * 1024 * 1024);
    expect(m.memoryLimitBytes).toBe(8 * 1024 * 1024 * 1024);
    expect(m.netRxBytes).toBe(1010);
    expect(m.netTxBytes).toBe(201);
    expect(m.at).toBe('2026-01-01T00:00:01Z');
  });

  it('falls back to cgroup v1 cache and percpu_usage length', () => {
    const prev = sample({
      cpu_stats: {
        cpu_usage: { total_usage: 0, percpu_usage: [0, 0] },
        system_cpu_usage: 0,
      },
    });
    const cur = sample({
      cpu_stats: {
        cpu_usage: { total_usage: 500, percpu_usage: [250, 250] },
        system_cpu_usage: 1000,
      },
      memory_stats: { usage: 1000, limit: 5000, stats: { cache: 400 } },
      networks: undefined,
    });
    const m = computeMetrics(prev, cur);
    expect(m.cpuPercent).toBe(100);
    expect(m.memoryBytes).toBe(600);
    expect(m.netRxBytes).toBe(0);
  });
});

describe('aggregateMetrics', () => {
  const pt = (
    at: string,
    cpu: number | null,
    mem: number,
  ): ContainerMetrics => ({
    at,
    cpuPercent: cpu,
    memoryBytes: mem,
    memoryLimitBytes: 1000,
    netRxBytes: 1,
    netTxBytes: 2,
  });

  it('sums the latest samples and buckets history by the sampler tick', () => {
    const a = {
      current: pt('2026-01-01T00:00:15.100Z', 10, 100),
      history: [
        pt('2026-01-01T00:00:00.000Z', 5, 50),
        pt('2026-01-01T00:00:15.100Z', 10, 100),
      ],
    };
    const b = {
      current: pt('2026-01-01T00:00:15.900Z', 20, 200),
      history: [
        pt('2026-01-01T00:00:00.800Z', 5, 60),
        pt('2026-01-01T00:00:15.900Z', 20, 200),
      ],
    };
    const m = aggregateMetrics([a, b], 15_000)!;
    expect(m.current).toMatchObject({
      cpuPercent: 30,
      memoryBytes: 300,
      memoryLimitBytes: 2000,
      netRxBytes: 2,
    });
    expect(m.history.map((p) => [p.cpuPercent, p.memoryBytes])).toEqual([
      [10, 110],
      [30, 300],
    ]);
  });

  it('is null without series and cpu is null when a task has none', () => {
    expect(aggregateMetrics([], 15_000)).toBeNull();
    const m = aggregateMetrics(
      [
        { current: pt('2026-01-01T00:00:00Z', null, 1), history: [] },
        { current: pt('2026-01-01T00:00:00Z', 3, 1), history: [] },
      ],
      15_000,
    )!;
    expect(m.current.cpuPercent).toBeNull();
    expect(m.current.memoryBytes).toBe(2);
  });
});
