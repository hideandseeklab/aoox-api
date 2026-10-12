import { ConflictException } from '@nestjs/common';
import { ProxyService } from '../../proxy/proxy.service';
import { Application } from '../application.entity';
import { UpdateApplicationService } from './update-application.service';

interface DomainRow {
  id: string;
  host: string;
  https: boolean;
  middlewares: string[];
  certificateId?: string | null;
}

function harness(
  over: Partial<Application> = {},
  activeDeployments = 0,
  extra: {
    domains?: DomainRow[];
    /** enabled middlewares per destination: server id (or 'host') -> refs */
    available?: Record<string, string[]>;
  } = {},
) {
  const app = {
    id: 'app-1',
    appName: 'web',
    hostPort: null,
    serverId: null,
    deployMode: 'container',
    replicas: 1,
    swarmNodeId: null,
    swarmConstraint: null,
    updateParallelism: 1,
    updateDelaySeconds: 0,
    updateOrder: 'auto',
    sourceType: 'image',
    imageRef: 'nginx:alpine',
    currentImage: 'nginx:alpine',
    status: 'running',
    cpuMillicores: null,
    memoryMb: null,
    ...over,
  } as unknown as Application;
  const save = jest.fn((a: Application) => Promise.resolve(a));
  // The runner-owned columns as the database has them right before the save;
  // tests overwrite this to simulate a deployment finishing mid-request.
  const dbRow = {
    status: app.status,
    currentImage: app.currentImage,
    imageDigest: app.imageDigest ?? null,
    imageCheckedAt: app.imageCheckedAt ?? null,
  };
  const applications = {
    findOwnedOrFail: jest.fn().mockResolvedValue(app),
    repo: { save, findOne: jest.fn(() => Promise.resolve({ ...dbRow })) },
    deployments: { count: jest.fn().mockResolvedValue(activeDeployments) },
    domains: {
      find: jest.fn(() => Promise.resolve(extra.domains ?? [])),
      save: jest.fn((d: DomainRow) => Promise.resolve(d)),
    },
  };
  const proxyConfig = {
    availableMiddlewares: jest.fn((serverId: string | null) =>
      Promise.resolve(
        (extra.available?.[serverId ?? 'host'] ?? []).map((ref) => ({
          ref,
          file: 'f',
        })),
      ),
    ),
  };
  const runner = {
    applyRuntimeConfig: jest.fn().mockResolvedValue(undefined),
    queueRuntimeConfig: jest.fn().mockResolvedValue(null),
  };
  const certSync = { syncServer: jest.fn().mockResolvedValue({}) };
  const hostPorts = { assertFree: jest.fn().mockResolvedValue(undefined) };
  const remote = { forServer: jest.fn().mockResolvedValue({}) };
  const svc = new UpdateApplicationService(
    applications as never,
    {} as never,
    {} as never,
    {
      resolveLink: jest.fn((_p: string, id?: string) =>
        Promise.resolve(id ?? 'env-prod'),
      ),
    } as never,
    { findOrFail: jest.fn().mockResolvedValue({}) } as never,
    remote as never,
    runner as never,
    { isActive: jest.fn().mockResolvedValue(true) } as never,
    hostPorts as never,
    proxyConfig as never,
    certSync as never,
    { get: jest.fn().mockResolvedValue(null) } as never,
  );
  return {
    svc,
    app,
    runner,
    hostPorts,
    save,
    applications,
    dbRow,
    proxyConfig,
    certSync,
  };
}

const update = (h: ReturnType<typeof harness>, hostPort: number | null) =>
  h.svc.execute('owner', 'app-1', { hostPort }, 'me@x.y');

describe('UpdateApplicationService host port', () => {
  it.each([
    ['null to number', null, 5434],
    ['number to other number', 5434, 5435],
    ['number to null', 5434, null],
  ])('recreates the running container: %s', async (_l, before, after) => {
    const h = harness({ hostPort: before });
    await update(h, after);
    expect(h.runner.applyRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(h.runner.applyRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ hostPort: after }),
    );
    expect(h.runner.queueRuntimeConfig).not.toHaveBeenCalled();
  });

  it('does nothing extra when the port is unchanged', async () => {
    const h = harness({ hostPort: 5434 });
    await update(h, 5434);
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
    expect(h.hostPorts.assertFree).not.toHaveBeenCalled();
  });

  it('checks the port is free before touching anything', async () => {
    const h = harness();
    h.hostPorts.assertFree.mockRejectedValueOnce(new Error('port in use'));
    await expect(update(h, 5434)).rejects.toThrow('port in use');
    expect(h.save).not.toHaveBeenCalled();
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('only saves for a stopped app (the next start recreates it) and never starts it', async () => {
    const h = harness({ status: 'stopped' });
    await update(h, 5434);
    expect(h.save).toHaveBeenCalled();
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
    expect(h.runner.queueRuntimeConfig).not.toHaveBeenCalled();
  });

  it('only saves for an app that was never deployed', async () => {
    const h = harness({ currentImage: null });
    await update(h, 5434);
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('queues a config deployment for a swarm service instead of recreating', async () => {
    const h = harness({ deployMode: 'service' });
    await update(h, 5434);
    expect(h.runner.queueRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('refuses with 409 while a deployment is active, without saving', async () => {
    const h = harness({}, 1);
    await expect(update(h, 5434)).rejects.toBeInstanceOf(ConflictException);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('lets other settings through while a deployment is active', async () => {
    const h = harness({}, 1);
    await h.svc.execute('owner', 'app-1', { name: 'New' }, 'me@x.y');
    expect(h.save).toHaveBeenCalled();
  });

  it('does not revert what a deployment recorded while the request was in flight', async () => {
    const h = harness({ status: 'running', currentImage: 'img:old' });
    h.dbRow.currentImage = 'img:new';
    h.dbRow.imageDigest = 'sha256:new';
    await h.svc.execute('owner', 'app-1', { name: 'New' }, 'me@x.y');
    const written = h.save.mock.calls[0][0];
    expect(written.name).toBe('New');
    expect(written.currentImage).toBe('img:new');
    expect(written.imageDigest).toBe('sha256:new');
  });

  it('still resets the digest baseline when imageRef changes', async () => {
    const h = harness({ imageDigest: 'sha256:old' });
    h.dbRow.imageDigest = 'sha256:old';
    await h.svc.execute('owner', 'app-1', { imageRef: 'nginx:1' }, 'me@x.y');
    expect(h.save.mock.calls[0][0].imageDigest).toBeNull();
  });

  it('restores the previous port (db + daemon) and reports a clear 409 when applying fails', async () => {
    const h = harness({ hostPort: 5000 });
    h.runner.applyRuntimeConfig
      .mockRejectedValueOnce(new Error('address already in use'))
      .mockResolvedValueOnce(undefined);
    await expect(update(h, 5434)).rejects.toThrow(
      /Could not apply the new host port \(address already in use\); the previous port was restored/,
    );
    expect(h.runner.applyRuntimeConfig).toHaveBeenCalledTimes(2);
    expect(h.app.hostPort).toBe(5000);
    const lastSaved = h.save.mock.calls.at(-1)?.[0];
    expect(lastSaved?.hostPort).toBe(5000);
  });

  it('marks the app as error when even the restore fails', async () => {
    const h = harness({ hostPort: 5000 });
    h.runner.applyRuntimeConfig
      .mockRejectedValueOnce(new Error('address already in use'))
      .mockRejectedValueOnce(new Error('daemon down'));
    await expect(update(h, 5434)).rejects.toThrow(/redeploy the application/);
    expect(h.app.status).toBe('error');
  });
});

describe('UpdateApplicationService container port', () => {
  const setPort = (h: ReturnType<typeof harness>, containerPort: number) =>
    h.svc.execute('owner', 'app-1', { containerPort }, 'me@x.y');

  it('recreates the running container so the proxy labels follow the port', async () => {
    const h = harness({ containerPort: 3000 });
    await setPort(h, 80);
    expect(h.runner.applyRuntimeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ containerPort: 80 }),
    );
  });

  it('does nothing extra when the port is unchanged', async () => {
    const h = harness({ containerPort: 80 });
    await setPort(h, 80);
    expect(h.runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('refuses while a deployment is in progress', async () => {
    const h = harness({ containerPort: 3000 }, 1);
    await expect(setPort(h, 80)).rejects.toThrow(
      /change the container port after it finishes/,
    );
  });

  it('restores the previous port when applying fails', async () => {
    const h = harness({ containerPort: 3000 });
    h.runner.applyRuntimeConfig
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    await expect(setPort(h, 80)).rejects.toThrow(
      /Could not apply the new container port \(boom\)/,
    );
    expect(h.app.containerPort).toBe(3000);
  });
});

describe('UpdateApplicationService moving to another proxy', () => {
  const dom = (host: string, middlewares: string[]): DomainRow => ({
    id: host,
    host,
    https: true,
    middlewares,
  });
  const move = (h: ReturnType<typeof harness>, serverId: string | null) =>
    h.svc.execute('owner', 'app-1', { serverId }, 'me@x.y') as Promise<
      Application & { droppedMiddlewares?: unknown }
    >;

  it('moving to a server without files drops every middleware, saves, and reports it', async () => {
    const h = harness({}, 0, {
      domains: [dom('a.x.com', ['auth@file', 'hdrs@file']), dom('b.x.com', [])],
      available: { srv2: [] },
    });
    const saved = await move(h, 'srv2');
    expect(h.proxyConfig.availableMiddlewares).toHaveBeenCalledWith('srv2');
    expect(h.applications.domains.save).toHaveBeenCalledTimes(1);
    expect(h.applications.domains.save).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'a.x.com', middlewares: [] }),
    );
    expect(saved.droppedMiddlewares).toEqual([
      { domain: 'a.x.com', names: ['auth@file', 'hdrs@file'] },
    ]);
  });

  it('keeps the middlewares whose name the destination defines in an enabled file, drops the rest', async () => {
    const h = harness({}, 0, {
      domains: [dom('a.x.com', ['auth@file', 'hdrs@file'])],
      available: { srv2: ['hdrs@file'] },
    });
    const saved = await move(h, 'srv2');
    expect(h.applications.domains.save).toHaveBeenCalledWith(
      expect.objectContaining({ middlewares: ['hdrs@file'] }),
    );
    expect(saved.droppedMiddlewares).toEqual([
      { domain: 'a.x.com', names: ['auth@file'] },
    ]);
  });

  it('a file that is only disabled on the destination does not count (availableMiddlewares lists enabled ones only)', async () => {
    const h = harness({}, 0, {
      domains: [dom('a.x.com', ['auth@file'])],
      available: { srv2: [] }, // the disabled file is simply not listed
    });
    const saved = await move(h, 'srv2');
    expect(saved.droppedMiddlewares).toEqual([
      { domain: 'a.x.com', names: ['auth@file'] },
    ]);
  });

  it('moving back to the host checks the host files (null server)', async () => {
    const h = harness({ serverId: 'srv2' }, 0, {
      domains: [dom('a.x.com', ['auth@file'])],
      available: { host: ['auth@file'] },
    });
    const saved = await move(h, null);
    expect(h.proxyConfig.availableMiddlewares).toHaveBeenCalledWith(null);
    expect(h.applications.domains.save).not.toHaveBeenCalled();
    expect('droppedMiddlewares' in saved).toBe(false);
  });

  it('remote to another remote uses the new server', async () => {
    const h = harness({ serverId: 'srv1' }, 0, {
      domains: [dom('a.x.com', ['auth@file'])],
      available: { srv1: ['auth@file'], srv2: [] },
    });
    const saved = await move(h, 'srv2');
    expect(saved.droppedMiddlewares).toEqual([
      { domain: 'a.x.com', names: ['auth@file'] },
    ]);
  });

  it('does not touch domains when the server does not change', async () => {
    const same = harness({ serverId: 'srv1' }, 0, {
      domains: [dom('a.x.com', ['auth@file'])],
    });
    await same.svc.execute('owner', 'app-1', { serverId: 'srv1' }, 'me@x.y');
    await same.svc.execute('owner', 'app-1', { name: 'x' }, 'me@x.y');
    expect(same.applications.domains.find).not.toHaveBeenCalled();
    expect(same.proxyConfig.availableMiddlewares).not.toHaveBeenCalled();
    expect(same.applications.domains.save).not.toHaveBeenCalled();
  });

  it('skips the proxy lookup when no domain has middlewares', async () => {
    const h = harness({}, 0, { domains: [dom('a.x.com', [])] });
    const saved = await move(h, 'srv2');
    expect(h.proxyConfig.availableMiddlewares).not.toHaveBeenCalled();
    expect('droppedMiddlewares' in saved).toBe(false);
  });

  it('the labels computed afterwards do not mention a dropped middleware', async () => {
    const rows = [dom('a.x.com', ['auth@file', 'hdrs@file'])];
    const h = harness({}, 0, {
      domains: rows,
      available: { srv2: ['hdrs@file'] },
    });
    await move(h, 'srv2');
    const labels = ProxyService.buildLabels(
      'web',
      80,
      rows.map((d) => ({
        host: d.host,
        https: d.https,
        middlewares: d.middlewares,
      })),
      { httpsPort: 443, acme: true },
    );
    const values = Object.entries(labels)
      .filter(([k]) => k.endsWith('.middlewares'))
      .map(([, v]) => v);
    expect(values).toContain('hdrs@file');
    expect(JSON.stringify(labels)).not.toContain('auth@file');
  });
});

describe('UpdateApplicationService moving with custom certificates', () => {
  const dom = (host: string, certificateId: string | null): DomainRow => ({
    id: host,
    host,
    https: true,
    middlewares: [],
    certificateId,
  });
  type Answer = Application & {
    droppedMiddlewares?: unknown;
    certificateSyncError?: string;
  };
  const move = (h: ReturnType<typeof harness>, serverId: string | null) =>
    h.svc.execute('owner', 'app-1', { serverId }, 'me@x.y') as Promise<Answer>;

  it('host to remote: writes the destination first, then sweeps the origin', async () => {
    const h = harness({}, 0, { domains: [dom('a.x.com', 'cert-1')] });
    const saved = await move(h, 'srv2');
    expect(h.certSync.syncServer.mock.calls).toEqual([['srv2'], [null]]);
    const [dest, origin] = h.certSync.syncServer.mock.invocationCallOrder;
    expect(dest).toBeLessThan(origin);
    expect(saved.serverId).toBe('srv2');
    expect('certificateSyncError' in saved).toBe(false);
  });

  it('remote to host: destination is the host (null), origin the old server', async () => {
    const h = harness({ serverId: 'srv1' }, 0, {
      domains: [dom('a.x.com', 'cert-1'), dom('b.x.com', null)],
    });
    await move(h, null);
    expect(h.certSync.syncServer.mock.calls).toEqual([[null], ['srv1']]);
  });

  it('remote to another remote syncs both servers', async () => {
    const h = harness({ serverId: 'srv1' }, 0, {
      domains: [dom('a.x.com', 'cert-1')],
    });
    await move(h, 'srv2');
    expect(h.certSync.syncServer.mock.calls).toEqual([['srv2'], ['srv1']]);
  });

  it('no domain with a certificate: nothing is synced', async () => {
    const h = harness({}, 0, {
      domains: [dom('a.x.com', null), dom('b.x.com', null)],
    });
    const saved = await move(h, 'srv2');
    expect(h.certSync.syncServer).not.toHaveBeenCalled();
    expect('certificateSyncError' in saved).toBe(false);
  });

  it('no server change: nothing is synced, even with certificates', async () => {
    const h = harness({ serverId: 'srv1' }, 0, {
      domains: [dom('a.x.com', 'cert-1')],
    });
    await h.svc.execute('owner', 'app-1', { serverId: 'srv1' }, 'me@x.y');
    await h.svc.execute('owner', 'app-1', { name: 'x' }, 'me@x.y');
    expect(h.certSync.syncServer).not.toHaveBeenCalled();
  });

  it('a failed destination sync keeps the move and reports certificateSyncError', async () => {
    const h = harness({}, 0, { domains: [dom('a.x.com', 'cert-1')] });
    h.certSync.syncServer.mockRejectedValueOnce(new Error('ssh refused'));
    const saved = await move(h, 'srv2');
    expect(saved.serverId).toBe('srv2');
    expect(h.save).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'srv2' }),
    );
    expect(saved.certificateSyncError).toMatch(/ssh refused/);
    expect(saved.certificateSyncError).toMatch(
      /Save the domain or the certificate again/,
    );
    // The origin sweep still runs.
    expect(h.certSync.syncServer.mock.calls).toEqual([['srv2'], [null]]);
  });

  it('a failed origin sync is only a warning', async () => {
    const h = harness({}, 0, { domains: [dom('a.x.com', 'cert-1')] });
    h.certSync.syncServer
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('old server down'));
    const saved = await move(h, 'srv2');
    expect(saved.serverId).toBe('srv2');
    expect('certificateSyncError' in saved).toBe(false);
  });

  it('still reports dropped middlewares next to a certificate sync problem, and queries domains once', async () => {
    const rows = [{ ...dom('a.x.com', 'cert-1'), middlewares: ['auth@file'] }];
    const h = harness({}, 0, { domains: rows, available: { srv2: [] } });
    h.certSync.syncServer.mockRejectedValueOnce(new Error('boom'));
    const saved = await move(h, 'srv2');
    expect(saved.droppedMiddlewares).toEqual([
      { domain: 'a.x.com', names: ['auth@file'] },
    ]);
    expect(saved.certificateSyncError).toMatch(/boom/);
    expect(h.applications.domains.find).toHaveBeenCalledTimes(1);
  });
});
