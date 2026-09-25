import { ConfigService } from '@nestjs/config';
import {
  cpuPercentBetween,
  readCpuTimes,
  readDisk,
  readMemory,
} from './host-metrics';
import {
  HOST_HISTORY_POINTS,
  HostMetricsService,
} from './host-metrics.service';
import { MonitoringService } from './monitoring.service';

describe('cpuPercentBetween', () => {
  it('is the busy share of the elapsed time, one decimal', () => {
    expect(
      cpuPercentBetween({ idle: 100, total: 1000 }, { idle: 400, total: 2000 }),
    ).toBe(70);
  });

  it('is null when no time elapsed', () => {
    expect(
      cpuPercentBetween({ idle: 1, total: 1 }, { idle: 1, total: 1 }),
    ).toBe(null);
  });
});

describe('HostMetricsService', () => {
  const svc = new HostMetricsService(
    {
      managedTotals: () => ({ containers: 0, memoryBytes: 0, cpuPercent: 0 }),
    } as unknown as MonitoringService,
    { get: () => undefined } as unknown as ConfigService,
  );

  it('reads the disk and yields zeros for a path that does not exist', () => {
    const d = readDisk();
    expect(d.totalBytes).toBeGreaterThan(d.usedBytes);
    expect(readDisk('/definitely/not/here')).toEqual({
      usedBytes: 0,
      totalBytes: 0,
    });
  });

  it('reads real host numbers and keeps a bounded history', () => {
    const t = readCpuTimes();
    expect(t.total).toBeGreaterThan(0);
    const m = readMemory();
    expect(m.totalBytes).toBeGreaterThan(m.usedBytes);
    for (let i = 0; i < HOST_HISTORY_POINTS + 5; i++) svc.sample();
    const live = svc.live();
    expect(live.history).toHaveLength(HOST_HISTORY_POINTS);
    expect(live.current?.memoryTotalBytes).toBe(m.totalBytes);
    expect(live.current?.diskTotalBytes).toBeGreaterThan(0);
    expect(live.cpus).toBeGreaterThan(0);
  });
});
