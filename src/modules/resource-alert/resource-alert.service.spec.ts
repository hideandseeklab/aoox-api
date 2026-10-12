import { ResourceAlertService } from './resource-alert.service';
import type { ResourceAlertRule } from './resource-alert-rule.entity';

const NOW = new Date('2026-10-12T10:00:30Z');

/** One rollup per minute, the newest at the minute of `end`. */
function minuteRows(ownerId: string, cpu: number[], end: Date) {
  const last = Math.floor(end.getTime() / 60_000) * 60_000;
  return cpu.map((v, i) => ({
    ownerId,
    resolution: 'minute',
    at: new Date(last - (cpu.length - 1 - i) * 60_000),
    cpuPercent: v,
    memoryBytes: '100',
    memoryLimitBytes: '1000',
  }));
}

function setup(opts: {
  rule?: Partial<ResourceAlertRule>;
  cpu: number[];
  ownerStatus?: string;
  deploying?: boolean;
}) {
  const rule = {
    id: 'r1',
    applicationId: 'a1',
    databaseId: null,
    metric: 'cpu',
    enabled: true,
    thresholdPercent: 90,
    durationMinutes: 3,
    status: 'ok',
    statusSince: null,
    lastValue: null,
    lastEvaluatedAt: null,
    lastAlertAt: null,
    application: {
      id: 'a1',
      name: 'web',
      status: opts.ownerStatus ?? 'running',
      project: { name: 'Shop' },
    },
    database: null,
    ...opts.rule,
  } as unknown as ResourceAlertRule;
  const rules = {
    find: jest.fn().mockResolvedValue([rule]),
    save: jest.fn((r: unknown) => Promise.resolve(r)),
  };
  const clock = { now: NOW };
  const samples = {
    find: jest.fn(() => Promise.resolve(minuteRows('a1', opts.cpu, clock.now))),
  };
  const deployments = {
    find: jest
      .fn()
      .mockResolvedValue(
        opts.deploying ? [{ id: 'd', applicationId: 'a1' }] : [],
      ),
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        addSelect: () => qb,
        where: () => qb,
        groupBy: () => qb,
        getRawMany: () => Promise.resolve([]),
      };
      return qb;
    },
  };
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const service = new ResourceAlertService(
    rules as never,
    samples as never,
    deployments as never,
    { broadcast } as never,
    { get: () => 'https://aoox.example.com' } as never,
  );
  const at = (d: Date) => {
    clock.now = d;
    return service.evaluateAll(d);
  };
  return { service, rule, rules, broadcast, at };
}

function sentParams(broadcast: jest.Mock): Record<string, unknown> {
  const calls = broadcast.mock.calls as Array<
    [string, { params: Record<string, unknown> }]
  >;
  return calls[0][1].params;
}

describe('ResourceAlertService.evaluateAll', () => {
  it('stays silent on the first breaching tick, alerts on the next, then not again', async () => {
    const { rule, broadcast, at } = setup({ cpu: [95, 96, 97] });
    await at(NOW);
    expect(rule.status).toBe('pending');
    expect(broadcast).not.toHaveBeenCalled();

    await at(new Date(NOW.getTime() + 60_000));
    expect(rule.status).toBe('alerting');
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [event, message] = broadcast.mock.calls[0] as [
      string,
      { params: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(event).toBe('resourceAlert');
    expect(message.params).toMatchObject({
      variant: 'alert',
      kind: 'application',
      name: 'web',
      project: 'Shop',
      metric: 'cpu',
      threshold: 90,
      durationMinutes: 3,
      reminder: false,
    });
    expect(message.data.applicationId).toBe('a1');

    await at(new Date(NOW.getTime() + 120_000));
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('continues an alert it loaded from the database without re-alerting', async () => {
    const { service, rule, broadcast } = setup({
      cpu: [95, 96, 97],
      rule: {
        status: 'alerting',
        statusSince: new Date(NOW.getTime() - 600_000),
        lastAlertAt: new Date(NOW.getTime() - 600_000),
      },
    });
    await service.evaluateAll(NOW);
    expect(rule.status).toBe('alerting');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reminds after the reminder interval', async () => {
    const { service, broadcast } = setup({
      cpu: [95, 96, 97],
      rule: {
        status: 'alerting',
        statusSince: new Date(NOW.getTime() - 7 * 3_600_000),
        lastAlertAt: new Date(NOW.getTime() - 7 * 3_600_000),
      },
    });
    await service.evaluateAll(NOW);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(sentParams(broadcast).reminder).toBe(true);
  });

  it('sends one recovered message when the value drops', async () => {
    const { service, rule, broadcast } = setup({
      cpu: [20, 25, 30],
      rule: {
        status: 'alerting',
        statusSince: new Date(NOW.getTime() - 600_000),
        lastAlertAt: new Date(NOW.getTime() - 600_000),
      },
    });
    await service.evaluateAll(NOW);
    expect(rule.status).toBe('ok');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(sentParams(broadcast)).toMatchObject({
      variant: 'recovered',
      breachSeconds: 600,
    });
    await service.evaluateAll(new Date(NOW.getTime() + 60_000));
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('resets silently for an owner that is not running', async () => {
    const { service, rule, broadcast } = setup({
      cpu: [95, 96, 97],
      ownerStatus: 'stopped',
      rule: { status: 'alerting', lastAlertAt: NOW },
    });
    await service.evaluateAll(NOW);
    expect(rule.status).toBe('ok');
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('leaves an alert alone while a deployment is active and drops a pending streak', async () => {
    const a = setup({
      cpu: [20, 20, 20],
      deploying: true,
      rule: { status: 'alerting', lastAlertAt: NOW },
    });
    await a.service.evaluateAll(NOW);
    expect(a.rule.status).toBe('alerting');
    expect(a.broadcast).not.toHaveBeenCalled();

    const b = setup({
      cpu: [95, 96, 97],
      deploying: true,
      rule: { status: 'pending' },
    });
    await b.service.evaluateAll(NOW);
    expect(b.rule.status).toBe('ok');
  });

  it('does nothing when no rule is enabled', async () => {
    const { service, rules } = setup({ cpu: [] });
    rules.find.mockResolvedValue([]);
    expect(await service.evaluateAll(NOW)).toBe(0);
  });
});

describe('ResourceAlertService.saveRule', () => {
  it('resets the state when the rule changes', async () => {
    const existing = {
      enabled: true,
      thresholdPercent: 90,
      durationMinutes: 5,
      status: 'alerting',
      statusSince: NOW,
      lastAlertAt: NOW,
      lastValue: 99,
      lastEvaluatedAt: NOW,
    };
    const rules = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn((r: unknown) => Promise.resolve(r)),
    };
    const service = new ResourceAlertService(
      rules as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.saveRule({ kind: 'application', id: 'a1' }, 'cpu', {
      thresholdPercent: 80,
    });
    expect(existing.status).toBe('ok');
    expect(existing.thresholdPercent).toBe(80);
    expect(existing.lastAlertAt).toBeNull();
  });
});

describe('ResourceAlertService.importConfig', () => {
  it('falls back with a warning instead of failing on out-of-range values', async () => {
    const saved: unknown[] = [];
    const rules = {
      findOne: jest.fn().mockResolvedValue(null),
      create: (x: unknown) => x,
      save: jest.fn((x: unknown) => {
        saved.push(x);
        return Promise.resolve(x);
      }),
    };
    const service = new ResourceAlertService(
      rules as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const warnings: string[] = [];
    await service.importConfig(
      { kind: 'application', id: 'a1' },
      {
        cpu: { enabled: true, thresholdPercent: 150, durationMinutes: 3 },
        memory: { enabled: true, thresholdPercent: 150, durationMinutes: 999 },
      },
      'app "web"',
      warnings,
    );
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ metric: 'cpu', thresholdPercent: 150 });
    expect(saved[1]).toMatchObject({
      metric: 'memory',
      thresholdPercent: 90,
      durationMinutes: 5,
    });
    expect(warnings).toHaveLength(2);
  });
});
