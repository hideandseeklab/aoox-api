/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matchers (expect.any/objectContaining) and mock.calls are loosely typed */
import { existsSync } from 'fs';
import type { Application } from '../application/application.entity';
import type { Domain } from '../application/domain.entity';
import { HttpMonitor } from './http-monitor.entity';
import { DEFAULT_CONFIG, HttpMonitorService } from './http-monitor.service';
import type { ProbeResult } from './http-probe';
import { REALERT_MS } from './monitor-state';

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: jest.fn().mockReturnValue(false),
}));
const existsSyncMock = existsSync as unknown as jest.Mock;

const T0 = new Date('2026-01-01T12:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function app(over: Partial<Application> = {}): Application {
  return {
    id: 'a1',
    name: 'My App',
    appName: 'my-app-x1',
    status: 'running',
    serverId: null,
    hostPort: null,
    containerPort: 3000,
    deployMode: 'container',
    ...over,
  } as Application;
}

function monitor(over: Partial<HttpMonitor> = {}): HttpMonitor {
  return {
    id: 'm1',
    applicationId: 'a1',
    ...DEFAULT_CONFIG,
    enabled: true,
    status: 'unknown',
    consecutiveFailures: 0,
    statusSince: null,
    lastCheckedAt: null,
    lastAlertAt: null,
    lastError: null,
    lastTarget: null,
    lastStatusCode: null,
    lastLatencyMs: null,
    ...over,
  } as HttpMonitor;
}

function domain(host: string, https: boolean, createdAt = 0): Domain {
  return {
    id: host,
    applicationId: 'a1',
    host,
    https,
    createdAt: new Date(createdAt),
  } as Domain;
}

function setup(
  opts: {
    monitors?: HttpMonitor[];
    domains?: Domain[];
    servers?: Array<Record<string, unknown>>;
    deployments?: Array<Record<string, unknown>>;
  } = {},
) {
  const rows = opts.monitors ?? [];
  const inserted: Array<Record<string, unknown>> = [];
  const incidents: Array<{
    id: string;
    monitorId: string;
    startedAt: Date;
    endedAt: Date | null;
    reason: string | null;
    failedChecks: number;
  }> = [];
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const monitors = {
    find: jest.fn(() => Promise.resolve(rows)),
    findOne: jest.fn(({ where }: { where: { applicationId: string } }) =>
      Promise.resolve(
        rows.find((m) => m.applicationId === where.applicationId) ?? null,
      ),
    ),
    save: jest.fn((m: HttpMonitor) => {
      if (!rows.includes(m)) rows.push(m);
      return Promise.resolve(m);
    }),
    create: jest.fn((x: object) => ({ id: 'new', ...x }) as HttpMonitor),
  };
  const checks = {
    insert: jest.fn((row: Record<string, unknown>) => {
      inserted.push(row);
      return Promise.resolve();
    }),
    find: jest.fn(({ take }: { take: number }) =>
      Promise.resolve(
        [...inserted]
          .reverse()
          .slice(0, take)
          .map((r) => ({ at: r.at })),
      ),
    ),
    query: jest.fn().mockResolvedValue([]),
  };
  const incidentRepo = {
    insert: jest.fn((row: Record<string, unknown>) => {
      incidents.push({
        id: `i${incidents.length + 1}`,
        endedAt: null,
        ...row,
      } as (typeof incidents)[number]);
      return Promise.resolve();
    }),
    update: jest.fn(
      (where: string | { monitorId: string }, patch: { endedAt: Date }) => {
        for (const i of incidents) {
          const hit =
            typeof where === 'string'
              ? i.id === where
              : i.monitorId === where.monitorId && i.endedAt === null;
          if (hit) i.endedAt = patch.endedAt;
        }
        return Promise.resolve();
      },
    ),
    findOne: jest.fn(() =>
      Promise.resolve(
        [...incidents].reverse().find((i) => i.endedAt === null) ?? null,
      ),
    ),
    find: jest.fn().mockResolvedValue([]),
    query: jest.fn(),
  };
  const service = new HttpMonitorService(
    monitors as never,
    checks as never,
    incidentRepo as never,
    {
      findOne: jest.fn().mockResolvedValue({ project: { name: 'Shop' } }),
    } as never,
    {
      find: jest.fn().mockResolvedValue(opts.domains ?? []),
    } as never,
    {
      find: jest
        .fn()
        .mockImplementation(({ where }: { where: { status?: unknown } }) =>
          Promise.resolve(
            (opts.deployments ?? []).filter((d) =>
              where.status ? d.kind === 'active' : d.kind === 'recent',
            ),
          ),
        ),
    } as never,
    {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            (opts.servers ?? []).find((s) => s.id === where.id) ?? null,
          ),
        ),
    } as never,
    { localSettings: { httpPort: 8088, httpsPort: 8443 } } as never,
    { broadcast } as never,
    { get: () => 'https://panel.example.com' } as never,
  );
  return { service, rows, monitors, inserted, incidents, broadcast };
}

const okProbe = (code = 200): (() => Promise<ProbeResult>) =>
  jest.fn().mockResolvedValue({ statusCode: code, latencyMs: 12, error: null });
const failProbe = (code: number | null = 500): (() => Promise<ProbeResult>) =>
  jest.fn().mockResolvedValue({
    statusCode: code,
    latencyMs: 30,
    error: code === null ? 'ECONNREFUSED' : null,
  });

describe('HttpMonitorService.resolveTarget', () => {
  beforeEach(() => existsSyncMock.mockReturnValue(false));

  it('prefers the first domain (public URL through the proxy), with the proxy port when not standard', async () => {
    const { service } = setup();
    const r = await service.resolveTarget(
      app(),
      { path: '/health', useInternal: false },
      [domain('one.example.com', true), domain('two.example.com', false)],
    );
    expect(r.target).toEqual({
      url: 'https://one.example.com:8443/health',
      source: 'domain',
    });
  });

  it('uses the standard port without a suffix, http for a non-https domain', async () => {
    const { service } = setup();
    const { proxy } = service as unknown as {
      proxy: { localSettings: { httpPort: number; httpsPort: number } };
    };
    proxy.localSettings = { httpPort: 80, httpsPort: 443 };
    const r = await service.resolveTarget(
      app(),
      { path: '/', useInternal: false },
      [domain('plain.example.com', false)],
    );
    expect(r.target?.url).toBe('http://plain.example.com/');
  });

  it('falls back to the host port when there is no domain (outside Docker: loopback)', async () => {
    const { service } = setup();
    const r = await service.resolveTarget(
      app({ hostPort: 18080 }),
      { path: '/ping', useInternal: false },
      [],
    );
    expect(r.target).toEqual({
      url: 'http://127.0.0.1:18080/ping',
      source: 'hostPort',
    });
  });

  it('inside Docker a container-mode app is reached by name on the aoox network', async () => {
    existsSyncMock.mockReturnValue(true);
    const { service } = setup();
    const r = await service.resolveTarget(
      app({ hostPort: 18080 }),
      { path: '/', useInternal: false },
      [],
    );
    expect(r.target).toEqual({
      url: 'http://aoox-app-my-app-x1:3000/',
      source: 'container',
    });
  });

  it('useInternal skips the domain', async () => {
    const { service } = setup();
    const r = await service.resolveTarget(
      app({ hostPort: 18080 }),
      { path: '/', useInternal: true },
      [domain('one.example.com', true)],
    );
    expect(r.target?.source).toBe('hostPort');
  });

  it('an application on a remote server uses that server (its proxy ports / its address)', async () => {
    const server = {
      id: 's1',
      host: '203.0.113.7',
      proxyHttpPort: 80,
      proxyHttpsPort: 443,
      acmeEmail: null,
      acmeStaging: false,
    };
    const { service } = setup({ servers: [server] });
    const viaDomain = await service.resolveTarget(
      app({ serverId: 's1' }),
      { path: '/', useInternal: false },
      [domain('r.example.com', true)],
    );
    expect(viaDomain.target?.url).toBe('https://r.example.com/');
    const viaPort = await service.resolveTarget(
      app({ serverId: 's1', hostPort: 9000 }),
      { path: '/x', useInternal: false },
      [],
    );
    expect(viaPort.target?.url).toBe('http://203.0.113.7:9000/x');
    const none = await service.resolveTarget(
      app({ serverId: 's1' }),
      { path: '/', useInternal: false },
      [],
    );
    expect(none.target).toBeNull();
  });

  it('no domain and no host port outside Docker: no target, with a hint', async () => {
    const { service } = setup();
    const r = await service.resolveTarget(
      app(),
      { path: '/', useInternal: false },
      [],
    );
    expect(r.target).toBeNull();
    expect(r.error).toMatch(/domain or a host port/);
  });

  it('refuses a path that could leave the host', async () => {
    const { service } = setup();
    for (const path of [
      '//evil.example.com/',
      'http://evil.example.com/',
      '/../x',
    ]) {
      const r = await service.resolveTarget(
        app({ hostPort: 1 }),
        { path, useInternal: false },
        [],
      );
      expect(r.target).toBeNull();
    }
  });
});

describe('HttpMonitorService.check (alerting)', () => {
  const a = app({ hostPort: 18080 });

  it('alerts exactly once after N failures, reminds never inside the cooldown, and reports recovery once', async () => {
    const { service, broadcast, incidents, inserted } = setup();
    const m = monitor({ failureThreshold: 2 });
    await service.check(m, a, [], at(0), okProbe());
    expect(m.status).toBe('up');
    expect(broadcast).not.toHaveBeenCalled();

    await service.check(m, a, [], at(5), failProbe(500));
    expect(m.status).toBe('up'); // one failure is not an outage
    expect(broadcast).not.toHaveBeenCalled();

    await service.check(m, a, [], at(10), failProbe(500));
    expect(m.status).toBe('down');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      'httpDown',
      expect.objectContaining({
        title: 'HTTP check failing: My App',
        level: 'failure',
        url: 'https://panel.example.com/applications/a1',
        data: expect.objectContaining({
          event: 'http.down',
          application: 'My App',
        }),
      }),
    );
    // The incident starts at the first failed check of the streak.
    expect(incidents).toHaveLength(1);
    expect(incidents[0].startedAt).toEqual(at(5));

    await service.check(m, a, [], at(15), failProbe(500));
    await service.check(m, a, [], at(20), failProbe(null));
    expect(broadcast).toHaveBeenCalledTimes(1);

    await service.check(m, a, [], at(25), okProbe());
    expect(m.status).toBe('up');
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenLastCalledWith(
      'httpDown',
      expect.objectContaining({
        title: 'HTTP check healthy again: My App',
        level: 'success',
        fields: expect.arrayContaining([['Down for', '20m']]),
        data: expect.objectContaining({ event: 'http.recovered' }),
      }),
    );
    expect(incidents[0].endedAt).toEqual(at(25));
    expect(inserted).toHaveLength(6); // every check is recorded

    await service.check(m, a, [], at(30), okProbe());
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('judges health by the configured codes (a 404 can be fine, a 302 not)', async () => {
    const { service, broadcast } = setup();
    const m = monitor({ failureThreshold: 1, expectedCodes: '404' });
    await service.check(m, a, [], at(0), failProbe(404));
    expect(m.status).toBe('up');
    await service.check(m, a, [], at(1), okProbe(302));
    expect(m.status).toBe('down');
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('an API restart in the middle of an outage does not re-announce it, and recovery still works', async () => {
    const down = monitor({
      status: 'down',
      consecutiveFailures: 6,
      statusSince: at(0),
      lastAlertAt: at(1),
    });
    const { service, broadcast, incidents } = setup();
    incidents.push({
      id: 'open',
      monitorId: 'm1',
      startedAt: at(0),
      endedAt: null,
      reason: 'HTTP 500',
      failedChecks: 2,
    });
    await service.check(down, a, [], at(30), failProbe(500));
    expect(broadcast).not.toHaveBeenCalled();
    await service.check(down, a, [], at(35), okProbe());
    expect(broadcast).toHaveBeenCalledWith(
      'httpDown',
      expect.objectContaining({ level: 'success' }),
    );
    expect(incidents[0].endedAt).toEqual(at(35));
  });

  it('a restart while the app is healthy does not produce a false "down"', async () => {
    const healthy = monitor({ status: 'up', consecutiveFailures: 0 });
    const { service, broadcast } = setup();
    await service.check(healthy, a, [], at(0), okProbe());
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reminds again only after the cooldown while it stays down', async () => {
    const m = monitor({
      status: 'down',
      consecutiveFailures: 10,
      statusSince: at(0),
      lastAlertAt: at(0),
    });
    const { service, broadcast } = setup();
    await service.check(m, a, [], at(REALERT_MS / 60_000 - 1), failProbe(500));
    expect(broadcast).not.toHaveBeenCalled();
    await service.check(m, a, [], at(REALERT_MS / 60_000), failProbe(500));
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      'httpDown',
      expect.objectContaining({ title: 'HTTP check still failing: My App' }),
    );
  });

  it('an application without a reachable address is a configuration issue: shown, never alerted', async () => {
    const { service, broadcast, inserted } = setup();
    const m = monitor({ failureThreshold: 1 });
    const r = await service.check(m, app(), [], at(0), failProbe(500));
    expect(r.ok).toBe(false);
    expect(m.lastError).toMatch(/domain or a host port/);
    expect(m.status).toBe('unknown');
    expect(broadcast).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('never overlaps itself', async () => {
    const { service } = setup();
    const m = monitor();
    let release: (r: ProbeResult) => void = () => undefined;
    const slow = jest.fn(
      () => new Promise<ProbeResult>((resolve) => (release = resolve)),
    );
    const first = service.check(m, a, [], at(0), slow);
    await new Promise((r) => setImmediate(r));
    const second = await service.check(m, a, [], at(0), okProbe());
    expect(second.error).toBe('already running');
    release({ statusCode: 200, latencyMs: 1, error: null });
    await first;
  });
});

describe('HttpMonitorService.runDue', () => {
  const dueMonitor = (
    over: Partial<HttpMonitor> = {},
    appOver: Partial<Application> = {},
  ) => monitor({ application: app({ hostPort: 1234, ...appOver }), ...over });

  it('checks only running, due applications with no deploy in progress or just finished', async () => {
    const running = dueMonitor(
      { id: 'm-run', applicationId: 'a-run' },
      { id: 'a-run' },
    );
    const stopped = dueMonitor(
      { id: 'm-stop', applicationId: 'a-stop', status: 'down' },
      { id: 'a-stop', status: 'stopped' },
    );
    const deploying = dueMonitor(
      { id: 'm-dep', applicationId: 'a-dep' },
      { id: 'a-dep' },
    );
    const justDeployed = dueMonitor(
      { id: 'm-new', applicationId: 'a-new' },
      { id: 'a-new' },
    );
    const notDue = dueMonitor(
      { id: 'm-wait', applicationId: 'a-wait', lastCheckedAt: at(-1) },
      { id: 'a-wait' },
    );
    const { service, rows } = setup({
      monitors: [running, stopped, deploying, justDeployed, notDue],
      deployments: [
        { kind: 'active', applicationId: 'a-dep' },
        { kind: 'recent', applicationId: 'a-new' },
      ],
    });
    const checked: string[] = [];
    jest.spyOn(service, 'check').mockImplementation((m) => {
      checked.push(m.id);
      return Promise.resolve({ ok: true, result: null, error: null });
    });
    const n = await service.runDue(at(0));
    expect(n).toBe(1);
    expect(checked).toEqual(['m-run']);
    // A stopped application is not "down": its state is reset, not alerted.
    expect(rows.find((r) => r.id === 'm-stop')?.status).toBe('unknown');
  });

  it('a failure streak that straddles a deploy starts over, an outage in progress is left alone', async () => {
    const flaky = dueMonitor(
      { id: 'm1', applicationId: 'a1', status: 'up', consecutiveFailures: 1 },
      { id: 'a1' },
    );
    const outage = dueMonitor(
      { id: 'm2', applicationId: 'a2', status: 'down', consecutiveFailures: 5 },
      { id: 'a2' },
    );
    const { service } = setup({
      monitors: [flaky, outage],
      deployments: [
        { kind: 'active', applicationId: 'a1' },
        { kind: 'active', applicationId: 'a2' },
      ],
    });
    jest.spyOn(service, 'check');
    await service.runDue(at(0));
    expect(flaky.consecutiveFailures).toBe(0);
    expect(outage.consecutiveFailures).toBe(5);
    expect(outage.status).toBe('down');
  });
});

describe('HttpMonitorService config', () => {
  it('turning a monitor off clears its state and closes an open incident', async () => {
    const m = monitor({
      status: 'down',
      consecutiveFailures: 4,
      statusSince: at(0),
    });
    const { service, incidents } = setup({ monitors: [m] });
    incidents.push({
      id: 'open',
      monitorId: 'm1',
      startedAt: at(0),
      endedAt: null,
      reason: null,
      failedChecks: 2,
    });
    await service.saveConfig(app(), { enabled: false });
    expect(m.enabled).toBe(false);
    expect(m.status).toBe('unknown');
    expect(m.consecutiveFailures).toBe(0);
    expect(incidents[0].endedAt).not.toBeNull();
  });

  it('turning it on starts from "not checked" and schedules the first check at once', async () => {
    const m = monitor({ enabled: false, status: 'up', lastCheckedAt: at(0) });
    const { service } = setup({ monitors: [m] });
    await service.saveConfig(app(), { enabled: true });
    expect(m.enabled).toBe(true);
    expect(m.status).toBe('unknown');
    expect(m.lastCheckedAt).toBeNull();
  });

  it('import: checks every value like an API request and falls back with a warning', async () => {
    const { service, rows } = setup();
    const warnings: string[] = [];
    await service.importConfig(
      app(),
      {
        enabled: true,
        path: '//evil.example.com/',
        intervalMinutes: 9999,
        timeoutSeconds: 10,
        expectedCodes: 'not-a-code',
        failureThreshold: 3,
        useInternal: true,
      },
      'application "x"',
      warnings,
    );
    const saved = rows[0];
    expect(saved).toMatchObject({
      enabled: true,
      path: '/',
      intervalMinutes: DEFAULT_CONFIG.intervalMinutes,
      timeoutSeconds: 10,
      expectedCodes: '200-399',
      failureThreshold: 3,
      useInternal: true,
    });
    expect(warnings).toHaveLength(2);
  });

  it('export returns only the config (no state), or null without a monitor', async () => {
    const m = monitor({ status: 'down', lastError: 'x' });
    const { service } = setup({ monitors: [m] });
    const out = await service.exportConfig('a1');
    expect(out).toEqual({
      enabled: true,
      path: '/',
      intervalMinutes: 5,
      timeoutSeconds: 10,
      expectedCodes: '200-399',
      failureThreshold: 2,
      useInternal: false,
    });
    expect(await service.exportConfig('nope')).toBeNull();
  });
});
