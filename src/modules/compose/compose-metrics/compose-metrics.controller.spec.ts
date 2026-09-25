import { ComposeMetricsController } from './compose-metrics.controller';
import { ComposeService } from '../compose.service';
import { MonitoringService } from '../../monitoring/monitoring.service';
import { MetricRetentionService } from '../../monitoring/metric-retention.service';
import { ContainerMetrics } from '../../monitoring/container-metrics';

const point = (cpu: number, mem: number, at: string): ContainerMetrics => ({
  at,
  cpuPercent: cpu,
  memoryBytes: mem,
  memoryLimitBytes: 1000,
  netRxBytes: 0,
  netTxBytes: 0,
});

describe('ComposeMetricsController', () => {
  const app = { id: 'stack-1' };
  const findOwnedOrFail = jest.fn().mockResolvedValue(app);
  const containers = jest.fn();
  const metricsFor = jest.fn();
  const history = jest.fn();
  const controller = new ComposeMetricsController(
    { findOwnedOrFail, containers } as unknown as ComposeService,
    { metricsFor } as unknown as MonitoringService,
    { history } as unknown as MetricRetentionService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('range=1h sums every service into a combined history via aggregateMetrics', async () => {
    containers.mockResolvedValue([
      { id: 'c1', name: 'n1', service: 'web' },
      { id: 'c2', name: 'n2', service: 'worker' },
    ]);
    metricsFor.mockImplementation((id: string) =>
      id === 'c1'
        ? {
            current: point(10, 100, '2026-01-01T00:00:15.000Z'),
            history: [point(10, 100, '2026-01-01T00:00:15.000Z')],
          }
        : {
            current: point(5, 50, '2026-01-01T00:00:15.000Z'),
            history: [point(5, 50, '2026-01-01T00:00:15.000Z')],
          },
    );

    const res = await controller.metrics(
      { sub: 'u1' } as never,
      {
        id: 'stack-1',
      },
      {},
    );

    expect(res.range).toBe('1h');
    expect(res.services).toHaveLength(2);
    expect(res.total).toEqual({
      cpuPercent: 15,
      memoryBytes: 150,
      containers: 2,
    });
    const combined = {
      ...point(15, 150, '2026-01-01T00:00:15.000Z'),
      memoryLimitBytes: 2000,
    };
    expect(res.history).toEqual([combined]);
    expect(res.current).toEqual(combined);
    expect(history).not.toHaveBeenCalled();
  });

  it('range=1h with no sampled containers yet returns empty history, not a crash', async () => {
    containers.mockResolvedValue([{ id: 'c1', name: 'n1', service: 'web' }]);
    metricsFor.mockReturnValue(null);

    const res = await controller.metrics(
      { sub: 'u1' } as never,
      {
        id: 'stack-1',
      },
      {},
    );

    expect(res.services).toEqual([
      {
        containerId: 'c1',
        name: 'n1',
        service: 'web',
        current: null,
        history: [],
      },
    ]);
    expect(res.total).toEqual({ cpuPercent: 0, memoryBytes: 0, containers: 0 });
    expect(res.current).toBeNull();
    expect(res.history).toEqual([]);
  });

  it('range=24h reads the stored rollup instead of the live sampler', async () => {
    history.mockResolvedValue([
      {
        at: '2026-01-01T00:00:00.000Z',
        cpuPercent: 12,
        memoryBytes: 400,
        memoryLimitBytes: 1000,
        netRxBytes: 0,
        netTxBytes: 0,
      },
    ]);

    const res = await controller.metrics(
      { sub: 'u1' } as never,
      { id: 'stack-1' },
      { range: '24h' },
    );

    expect(history).toHaveBeenCalledWith('compose', 'stack-1', '24h');
    expect(res.services).toEqual([]);
    expect(res.total).toEqual({
      cpuPercent: 12,
      memoryBytes: 400,
      containers: 0,
    });
    expect(res.current).toMatchObject({ cpuPercent: 12, memoryBytes: 400 });
    expect(res.range).toBe('24h');
    expect(containers).not.toHaveBeenCalled();
  });

  it('range=24h with no stored rows yet returns an empty, not-null, response', async () => {
    history.mockResolvedValue([]);

    const res = await controller.metrics(
      { sub: 'u1' } as never,
      { id: 'stack-1' },
      { range: '30d' },
    );

    expect(res.total).toEqual({ cpuPercent: 0, memoryBytes: 0, containers: 0 });
    expect(res.current).toBeNull();
    expect(res.history).toEqual([]);
  });
});
