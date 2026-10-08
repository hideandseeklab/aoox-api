import { ProxyConfigSyncService } from './proxy-config-sync.service';
import { ProxyConfigFile } from './proxy-config.entity';

const MW =
  'http:\n  middlewares:\n    hdrs:\n      headers:\n        frameDeny: true\n';

interface TarFile {
  name: string;
  mode: string;
  content: string;
}

/** Reads back the minimal ustar archives tarFiles() builds. */
function untar(buf: Buffer): TarFile[] {
  const out: TarFile[] = [];
  let off = 0;
  while (off + 512 <= buf.length && buf[off] !== 0) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    const mode = buf.toString('utf8', off + 100, off + 107);
    const size = parseInt(buf.toString('utf8', off + 124, off + 135), 8);
    out.push({
      name,
      mode,
      content: buf.toString('utf8', off + 512, off + 512 + size),
    });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const row = (name: string, extra: Partial<ProxyConfigFile> = {}) =>
  ({
    id: `id-${name}`,
    name,
    serverId: null,
    content: MW,
    enabled: true,
    ...extra,
  }) as ProxyConfigFile;

function makeHandle(
  label: string,
  opts: { log?: string; proxy?: Record<string, unknown> | null } = {},
) {
  const archives: Array<{ path: string; files: TarFile[]; binds?: string[] }> =
    [];
  const prunes: Array<{ cmd: string[]; env: string[]; binds: string[] }> = [];
  const events: string[] = [];
  const engine = {
    target: label,
    createVolume: jest.fn(() => Promise.resolve()),
    createContainer: jest.fn((body: { HostConfig?: { Binds?: string[] } }) => {
      events.push('create');
      return Promise.resolve(
        `helper-${label}-${JSON.stringify(body.HostConfig)}`,
      );
    }),
    putArchive: jest.fn((_id: string, path: string, tar: Buffer) => {
      events.push('put');
      archives.push({ path, files: untar(tar) });
      return Promise.resolve();
    }),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    containerLogsSince: jest.fn(() => Promise.resolve(opts.log ?? '')),
  };
  const handle = {
    engine,
    ensureImage: jest.fn().mockResolvedValue(undefined),
    findContainerByName: jest.fn().mockResolvedValue({ Id: 'proxy-id' }),
    runOnceWithOutput: jest.fn(
      (body: {
        Cmd: string[];
        Env: string[];
        HostConfig: { Binds: string[] };
      }) => {
        events.push('prune');
        prunes.push({
          cmd: body.Cmd,
          env: body.Env,
          binds: body.HostConfig.Binds,
        });
        return Promise.resolve({ code: 0, output: '' });
      },
    ),
  };
  return { handle, engine, archives, prunes, events };
}

function make(
  rowsByServer: Record<string, ProxyConfigFile[]>,
  status: Partial<Record<string, unknown>> = {},
  handleOpts: Parameters<typeof makeHandle>[1] = {},
) {
  const files = {
    find: jest.fn((q: { where: { serverId: unknown } }) => {
      const sid = q.where.serverId;
      const key = typeof sid === 'string' ? sid : 'local';
      return Promise.resolve(rowsByServer[key] ?? []);
    }),
  };
  const proxy = {
    localSettings: { httpPort: 80, httpsPort: 443, acmeEmail: null },
    statusOn: jest.fn().mockResolvedValue({
      installed: true,
      running: true,
      customCerts: true,
      ...status,
    }),
    upgradeToCustomCerts: jest.fn().mockResolvedValue(true),
  };
  const local = makeHandle('local', handleOpts);
  const srv = makeHandle('srv1', handleOpts);
  const remote = {
    forServer: jest.fn((id: string | null) =>
      Promise.resolve(id ? srv.handle : local.handle),
    ),
  };
  const servers = {
    findOrFail: jest.fn().mockResolvedValue({
      proxyHttpPort: 8080,
      proxyHttpsPort: 8443,
      acmeEmail: null,
      acmeStaging: false,
    }),
  };
  const svc = new ProxyConfigSyncService(
    files as never,
    proxy as never,
    remote as never,
    servers as never,
  );
  svc.verifyWaitMs = 0;
  return { svc, files, proxy, local, srv, remote, servers };
}

describe('ProxyConfigSyncService', () => {
  it('writes only user-<name>.yml files into the dynamic volume, never certs.yml, crt or key', async () => {
    const t = make({ local: [row('a'), row('b')] });
    const report = await t.svc.sync(null);
    expect(report).toMatchObject({ files: 2, proxy: 'running', errors: [] });
    expect(t.local.archives).toHaveLength(1);
    expect(t.local.archives[0].path).toBe('/dynamic');
    expect(t.local.archives[0].files.map((f) => f.name)).toEqual([
      'user-a.yml',
      'user-b.yml',
    ]);
    expect(t.local.archives[0].files[0].content).toBe(MW);
    expect(t.local.archives[0].files[0].mode).toContain('644');
    for (const f of t.local.archives[0].files) {
      expect(f.name).toMatch(/^user-.*\.yml$/);
    }
    expect(t.local.engine.createContainer.mock.calls[0][0]).toMatchObject({
      HostConfig: { Binds: ['aoox_proxy_certs:/dynamic'] },
    });
  });

  it('sweeps only user-*.yml, after writing, keeping the enabled ones', async () => {
    const t = make({ local: [row('a')] });
    await t.svc.sync(null);
    expect(t.local.events).toEqual(['create', 'put', 'prune']);
    const p = t.local.prunes[0];
    const script = p.cmd.join(' ');
    expect(script).toContain('user-*.yml');
    expect(script).not.toMatch(/\*\.crt|\*\.key|certs\.yml/);
    expect(p.env).toEqual(['KEEP=user-a.yml']);
    expect(p.binds).toEqual(['aoox_proxy_certs:/dynamic']);
  });

  it('with nothing enabled it writes nothing and removes every user file', async () => {
    const t = make({ local: [] });
    const report = await t.svc.sync(null);
    expect(report.files).toBe(0);
    expect(t.local.archives).toHaveLength(0);
    expect(t.local.prunes[0].env).toEqual(['KEEP=']);
  });

  it('uses the remote daemon and its proxy settings for a server', async () => {
    const t = make({ srv1: [row('r', { serverId: 'srv1' })] });
    await t.svc.sync('srv1');
    expect(t.remote.forServer).toHaveBeenCalledWith('srv1');
    expect(t.servers.findOrFail).toHaveBeenCalledWith('srv1');
    expect(t.srv.archives[0].files.map((f) => f.name)).toEqual(['user-r.yml']);
    expect(t.local.archives).toHaveLength(0);
  });

  it('warns instead of failing when the proxy is not running or not installed', async () => {
    const stopped = make({ local: [row('a')] }, { running: false });
    expect(await stopped.svc.sync(null, { name: 'a', refs: [] })).toMatchObject(
      {
        proxy: 'not-running',
        verified: false,
        warning: expect.stringContaining('not running') as string,
      },
    );
    expect(stopped.local.engine.containerLogsSince).not.toHaveBeenCalled();
    const absent = make(
      { local: [row('a')] },
      { installed: false, running: false },
    );
    expect((await absent.svc.sync(null)).proxy).toBe('not-installed');
  });

  it('recreates an old proxy once so it loads the directory', async () => {
    const t = make({ local: [row('a')] }, { customCerts: false });
    const report = await t.svc.sync(null);
    expect(t.proxy.upgradeToCustomCerts).toHaveBeenCalledTimes(1);
    expect(report.proxyRecreated).toBe(true);
    expect(report.notice).toMatch(/recreated once/);
    const none = make({ local: [] }, { customCerts: false });
    await none.svc.sync(null);
    expect(none.proxy.upgradeToCustomCerts).not.toHaveBeenCalled();
  });

  it('verification reports error lines about the file, ignores other files', async () => {
    const log = [
      '2026-10-06T10:00:00Z time="x" level=error msg="middleware \\"hdrs@file\\" is broken"',
      '2026-10-06T10:00:01Z time="x" level=error msg="Error in /etc/traefik/dynamic/user-other.yml"',
      '2026-10-06T10:00:02Z time="x" level=info msg="Configuration loaded from user-a.yml"',
    ].join('\n');
    const t = make({ local: [row('a')] }, {}, { log });
    const report = await t.svc.sync(null, { name: 'a', refs: ['hdrs@file'] });
    expect(report.verified).toBe(false);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toContain('hdrs@file');
    const clean = make({ local: [row('a')] }, {}, { log: 'level=info msg=ok' });
    expect(
      await clean.svc.sync(null, { name: 'a', refs: ['hdrs@file'] }),
    ).toMatchObject({ verified: true, errors: [] });
  });

  it('serializes syncs of the same daemon', async () => {
    const t = make({ local: [row('a')] });
    const order: string[] = [];
    t.local.engine.putArchive.mockImplementation(async () => {
      order.push('start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('end');
    });
    await Promise.all([t.svc.sync(null), t.svc.sync(null)]);
    expect(order).toEqual(['start', 'end', 'start', 'end']);
  });

  it('state() reads the proxy without writing anything', async () => {
    const old = make({ local: [row('a')] }, { customCerts: false });
    expect(await old.svc.state(null)).toEqual({
      proxy: 'running',
      fileProvider: false,
      needsRecreate: true,
    });
    expect(old.local.archives).toHaveLength(0);
    const stopped = make({}, { running: false, customCerts: false });
    expect((await stopped.svc.state(null)).needsRecreate).toBe(false);
    const absent = make({}, { installed: false, running: false });
    expect((await absent.svc.state(null)).proxy).toBe('not-installed');
  });
});
