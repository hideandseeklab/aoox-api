import { ConfigService } from '@nestjs/config';
import { ContainerMetrics } from './container-metrics';
import {
  averageBucket,
  MetricRetentionService,
} from './metric-retention.service';
import { MonitoringService } from './monitoring.service';
import { DockerService } from '../docker/docker.service';

const point = (cpu: number | null, mem: number): ContainerMetrics => ({
  at: '2026-01-01T00:00:00.000Z',
  cpuPercent: cpu,
  memoryBytes: mem,
  memoryLimitBytes: 1000,
  netRxBytes: 10,
  netTxBytes: 20,
});

describe('averageBucket', () => {
  it('averages over time and keeps the sum across containers', () => {
    // Two containers, two points each: mean per container 10+30 = 40 CPU.
    const row = averageBucket(
      [point(10, 100), point(10, 100), point(30, 300), point(30, 300)],
      2,
    );
    expect(row.cpuPercent).toBe(40);
    expect(row.memoryBytes).toBe('400');
    expect(row.netRxBytes).toBe('20');
  });

  it('is null for cpu when no point reported one', () => {
    expect(averageBucket([point(null, 5)], 1).cpuPercent).toBeNull();
    expect(averageBucket([point(null, 5)], 1).memoryBytes).toBe('5');
  });

  it('rounds a single container over several points', () => {
    const row = averageBucket([point(10, 100), point(20, 200)], 1);
    expect(row.cpuPercent).toBe(15);
    expect(row.memoryBytes).toBe('150');
  });
});

describe('MetricRetentionService.rollupMinute — compose ownership', () => {
  const listContainers = jest.fn();
  const sampledContainers = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);
  const create = jest.fn((row: unknown) => row);
  const svc = new MetricRetentionService(
    { upsert, create } as never,
    { sampledContainers } as unknown as MonitoringService,
    { engine: { listContainers } } as unknown as DockerService,
    { get: () => undefined } as unknown as ConfigService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('rolls a compose-labeled container up under its stack id, not application/database', async () => {
    listContainers.mockResolvedValue([
      {
        Id: 'c1',
        Labels: { 'aoox.component': 'compose', 'aoox.compose': 'stack-1' },
      },
    ]);
    sampledContainers.mockReturnValue([
      { containerId: 'c1', points: [point(20, 200)] },
    ]);

    await svc.rollupMinute();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ ownerKind: 'compose', ownerId: 'stack-1' }),
      expect.anything(),
    );
  });

  it('ignores a compose container with no aoox.compose label (bare service)', async () => {
    listContainers.mockResolvedValue([
      { Id: 'c2', Labels: { 'aoox.component': 'compose' } },
    ]);
    sampledContainers.mockReturnValue([
      { containerId: 'c2', points: [point(20, 200)] },
    ]);

    await svc.rollupMinute();

    expect(upsert).not.toHaveBeenCalled();
  });
});
