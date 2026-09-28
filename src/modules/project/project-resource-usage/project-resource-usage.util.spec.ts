import { ContainerMetrics } from '../../monitoring/container-metrics';
import {
  buildProjectUsage,
  toResourceUsageSummary,
} from './project-resource-usage.util';

function point(overrides: Partial<ContainerMetrics>): ContainerMetrics {
  return {
    at: '2026-01-01T00:00:00.000Z',
    cpuPercent: 0,
    memoryBytes: 0,
    memoryLimitBytes: 0,
    netRxBytes: 0,
    netTxBytes: 0,
    ...overrides,
  };
}

describe('buildProjectUsage', () => {
  it('returns null when the project has no sampled containers', () => {
    expect(buildProjectUsage([])).toBeNull();
  });

  it('sums CPU/memory across every container at each tick', () => {
    const usage = buildProjectUsage([
      {
        current: point({
          at: '2026-01-01T00:00:15.000Z',
          cpuPercent: 10,
          memoryBytes: 100,
        }),
        history: [
          point({
            at: '2026-01-01T00:00:00.000Z',
            cpuPercent: 5,
            memoryBytes: 50,
          }),
          point({
            at: '2026-01-01T00:00:15.000Z',
            cpuPercent: 10,
            memoryBytes: 100,
          }),
        ],
      },
      {
        current: point({
          at: '2026-01-01T00:00:15.000Z',
          cpuPercent: 20,
          memoryBytes: 200,
        }),
        history: [
          point({
            at: '2026-01-01T00:00:00.000Z',
            cpuPercent: 15,
            memoryBytes: 150,
          }),
          point({
            at: '2026-01-01T00:00:15.000Z',
            cpuPercent: 20,
            memoryBytes: 200,
          }),
        ],
      },
    ]);
    expect(usage?.containers).toBe(2);
    expect(usage?.current?.cpuPercent).toBe(30);
    expect(usage?.current?.memoryBytes).toBe(300);
    expect(usage?.history).toHaveLength(2);
    expect(usage?.history[0].cpuPercent).toBe(20);
    expect(usage?.history[0].memoryBytes).toBe(200);
  });

  it('converts the cumulative network counters into a bytes/sec rate', () => {
    const usage = buildProjectUsage([
      {
        current: point({
          at: '2026-01-01T00:00:15.000Z',
          netRxBytes: 15_000,
          netTxBytes: 3_000,
        }),
        history: [
          point({
            at: '2026-01-01T00:00:00.000Z',
            netRxBytes: 0,
            netTxBytes: 0,
          }),
          point({
            at: '2026-01-01T00:00:15.000Z',
            netRxBytes: 15_000,
            netTxBytes: 3_000,
          }),
        ],
      },
    ]);
    expect(usage?.history[0].netRxBytesPerSec).toBeNull(); // first tick has no delta
    expect(usage?.history[1].netRxBytesPerSec).toBe(1_000);
    expect(usage?.history[1].netTxBytesPerSec).toBe(200);
  });

  it('clamps a negative delta (a container left the sum) to zero instead of reporting a negative rate', () => {
    const usage = buildProjectUsage([
      {
        current: point({ at: '2026-01-01T00:00:15.000Z', netRxBytes: 100 }),
        history: [
          point({ at: '2026-01-01T00:00:00.000Z', netRxBytes: 10_000 }),
          point({ at: '2026-01-01T00:00:15.000Z', netRxBytes: 100 }),
        ],
      },
    ]);
    expect(usage?.history[1].netRxBytesPerSec).toBe(0);
  });
});

describe('toResourceUsageSummary', () => {
  it('returns null for a null point', () => {
    expect(toResourceUsageSummary(null)).toBeNull();
  });

  it('narrows a point to the list-projects summary shape', () => {
    expect(
      toResourceUsageSummary({
        at: '2026-01-01T00:00:15.000Z',
        cpuPercent: 12.5,
        memoryBytes: 1_000,
        memoryLimitBytes: 2_000,
        netRxBytesPerSec: 500,
        netTxBytesPerSec: 100,
      }),
    ).toEqual({
      cpuPercent: 12.5,
      memoryBytes: 1_000,
      netRxBytesPerSec: 500,
      netTxBytesPerSec: 100,
    });
  });
});
