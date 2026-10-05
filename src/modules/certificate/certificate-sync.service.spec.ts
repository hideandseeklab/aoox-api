import { CertificateSyncService } from './certificate-sync.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

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

function makeHandle(label: string) {
  const archives: Array<{ id: string; path: string; files: TarFile[] }> = [];
  const events: string[] = [];
  const engine = {
    target: label,
    createVolume: jest.fn((n: string) => {
      events.push(`volume:${n}`);
      return Promise.resolve();
    }),
    createContainer: jest.fn().mockResolvedValue(`helper-${label}`),
    putArchive: jest.fn((id: string, path: string, tar: Buffer) => {
      events.push('put');
      archives.push({ id, path, files: untar(tar) });
      return Promise.resolve();
    }),
    removeContainer: jest.fn().mockResolvedValue(undefined),
  };
  const handle = {
    engine,
    ensureImage: jest.fn().mockResolvedValue(undefined),
    runOnceWithOutput: jest.fn((body: unknown) => {
      events.push('prune');
      void body;
      return Promise.resolve({ code: 0, output: '' });
    }),
  };
  return { handle, engine, archives, events };
}

function makeService(opts: {
  idsByServer: Record<string, string[]>;
  upgrade?: boolean;
}) {
  const where: string[] = [];
  const domainsRepo = {
    createQueryBuilder: jest.fn(() => {
      let server: string | null = null;
      const qb: Record<string, jest.Mock> = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn((sql: string, p?: { serverId: string }) => {
          where.push(sql);
          server = p?.serverId ?? null;
          return qb;
        }),
        getRawMany: jest.fn(() =>
          Promise.resolve(
            (opts.idsByServer[server ?? 'local'] ?? []).map((id) => ({ id })),
          ),
        ),
      };
      return qb;
    }),
  };
  const certs = {
    withKeys: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          fingerprint: `${id === A ? 'AB:CD:EF:01' : '12:34:56:78'}:00:00:00:00`,
          certificatePem: `CERT-${id}`,
          keyPem: `KEY-${id}`,
        })),
      ),
    ),
  };
  const proxy = {
    localSettings: { httpPort: 80, httpsPort: 443, acmeEmail: null },
    upgradeToCustomCerts: jest.fn().mockResolvedValue(opts.upgrade ?? false),
  };
  const local = makeHandle('local');
  const srv = makeHandle('srv1');
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
  const svc = new CertificateSyncService(
    domainsRepo as never,
    certs as never,
    proxy as never,
    remote as never,
    servers as never,
  );
  return { svc, certs, proxy, local, srv, remote, where };
}

describe('CertificateSyncService', () => {
  it('writes certificates 0644, keys 0600 and certs.yml last, into the cert volume of the host', async () => {
    const t = makeService({ idsByServer: { local: [A, B] } });
    const res = await t.svc.syncServer(null);

    expect(res).toEqual({ certificates: 2, proxyRecreated: false });
    expect(t.remote.forServer).toHaveBeenCalledWith(null);
    expect(t.local.engine.createVolume).toHaveBeenCalledWith(
      'aoox_proxy_certs',
    );
    const [archive] = t.local.archives;
    expect(archive.path).toBe('/certs');
    expect(archive.files.map((f) => f.name)).toEqual([
      `${A}-abcdef01.crt`,
      `${A}-abcdef01.key`,
      `${B}-12345678.crt`,
      `${B}-12345678.key`,
      'certs.yml',
    ]);
    const modes = Object.fromEntries(
      archive.files.map((f) => [f.name, f.mode]),
    );
    expect(modes[`${A}-abcdef01.key`]).toBe('0000600');
    expect(modes[`${B}-12345678.key`]).toBe('0000600');
    expect(modes[`${A}-abcdef01.crt`]).toBe('0000644');
    expect(modes['certs.yml']).toBe('0000644');
    const yml = archive.files.at(-1)!.content;
    expect(yml).toContain(`certFile: /etc/traefik/dynamic/${A}-abcdef01.crt`);
    expect(yml).toContain(`keyFile: /etc/traefik/dynamic/${B}-12345678.key`);
    // The helper is created stopped and always removed.
    expect(t.local.engine.removeContainer).toHaveBeenCalledWith(
      'helper-local',
      true,
    );
  });

  it('only selects the domains of apps on the host for serverId null, and of that server otherwise', async () => {
    const t = makeService({
      idsByServer: { local: [A], srv1: [B] },
    });
    await t.svc.syncServer(null);
    await t.svc.syncServer('srv1');

    expect(t.remote.forServer).toHaveBeenCalledWith('srv1');
    expect(t.where).toEqual(['a.server_id IS NULL', 'a.server_id = :serverId']);
    // Each daemon only receives its own certificate.
    expect(t.local.archives[0].files.map((f) => f.name)).toContain(
      `${A}-abcdef01.crt`,
    );
    expect(t.local.archives[0].files.map((f) => f.name)).not.toContain(
      `${B}-12345678.crt`,
    );
    expect(t.srv.archives[0].files.map((f) => f.name)).toContain(
      `${B}-12345678.crt`,
    );
    expect(t.srv.archives[0].files.map((f) => f.name)).not.toContain(
      `${A}-abcdef01.crt`,
    );
    // The remote server's own proxy settings reach the upgrade check.
    expect(t.proxy.upgradeToCustomCerts).toHaveBeenLastCalledWith(
      t.srv.handle,
      expect.objectContaining({ httpPort: 8080, httpsPort: 8443 }),
    );
  });

  it('prunes files no domain uses any more, keeping the current set (via env, no interpolation)', async () => {
    const t = makeService({ idsByServer: { local: [A] } });
    await t.svc.syncServer(null);
    const body = t.local.handle.runOnceWithOutput.mock.calls[0][0] as {
      Cmd: string[];
      Env: string[];
      HostConfig: { Binds: string[] };
    };
    expect(body.Env).toEqual([
      `KEEP=${A}-abcdef01.crt ${A}-abcdef01.key certs.yml`,
      'GRACE=5',
    ]);
    expect(body.Cmd.join(' ')).not.toContain(A);
    expect(body.HostConfig.Binds).toEqual(['aoox_proxy_certs:/certs']);
  });

  it('with no certificate in use writes an empty config and prunes everything, without touching the proxy', async () => {
    const t = makeService({ idsByServer: {} });
    const res = await t.svc.syncServer(null);
    expect(res).toEqual({ certificates: 0, proxyRecreated: false });
    expect(t.local.archives[0].files.map((f) => f.name)).toEqual(['certs.yml']);
    expect(t.local.archives[0].files[0].content).toContain('certificates: []');
    expect(t.proxy.upgradeToCustomCerts).not.toHaveBeenCalled();
    expect(t.local.handle.runOnceWithOutput).toHaveBeenCalled();
  });

  it('writes the files before the proxy is recreated, and reports the recreation', async () => {
    const t = makeService({ idsByServer: { local: [A] }, upgrade: true });
    t.proxy.upgradeToCustomCerts.mockImplementation(() => {
      t.local.events.push('upgrade');
      return Promise.resolve(true);
    });
    const res = await t.svc.syncServer(null);
    expect(res.proxyRecreated).toBe(true);
    expect(t.local.events.indexOf('put')).toBeLessThan(
      t.local.events.indexOf('upgrade'),
    );
  });

  it('survives a failed prune (an unused file stays) but reports a failed write', async () => {
    const t = makeService({ idsByServer: { local: [A] } });
    t.local.handle.runOnceWithOutput.mockRejectedValueOnce(new Error('boom'));
    await expect(t.svc.syncServer(null)).resolves.toMatchObject({
      certificates: 1,
    });

    t.local.engine.putArchive.mockRejectedValueOnce(new Error('daemon down'));
    await expect(t.svc.syncServer(null)).rejects.toThrow('daemon down');
    // The helper container is still cleaned up.
    expect(t.local.engine.removeContainer).toHaveBeenCalled();
  });

  it('runs syncs of one daemon one after the other, even when one fails', async () => {
    const t = makeService({ idsByServer: { local: [A] } });
    const order: string[] = [];
    let release!: () => void;
    t.local.engine.putArchive
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            order.push('first-start');
            release = () => {
              order.push('first-end');
              reject(new Error('first failed'));
              resolve();
            };
          }),
      )
      .mockImplementationOnce(() => {
        order.push('second');
        return Promise.resolve();
      });
    const first = t.svc.syncServer(null);
    const second = t.svc.syncServer(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['first-start']);
    release();
    await expect(first).rejects.toThrow('first failed');
    await expect(second).resolves.toMatchObject({ certificates: 1 });
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('replacing a certificate writes a new, differently named pair first and certs.yml last, and prunes the old pair', async () => {
    const t = makeService({ idsByServer: { local: [A] } });
    await t.svc.syncServer(null);
    t.certs.withKeys.mockImplementationOnce((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          fingerprint: '99:88:77:66:00:00:00:00',
          certificatePem: 'NEW-CERT',
          keyPem: 'NEW-KEY',
        })),
      ),
    );
    await t.svc.syncServer(null);

    const [first, second] = t.local.archives;
    const names = (a: typeof first) => a.files.map((f) => f.name);
    expect(names(first)).toContain(`${A}-abcdef01.crt`);
    expect(names(second)).toEqual([
      `${A}-99887766.crt`,
      `${A}-99887766.key`,
      'certs.yml',
    ]);
    expect(second.files.at(-1)!.content).toContain(`${A}-99887766.key`);
    expect(second.files.at(-1)!.content).not.toContain('abcdef01');
    // The old pair is not in the keep list of the second sync, so it is swept.
    const prune = t.local.handle.runOnceWithOutput.mock.calls[1][0] as {
      Env: string[];
    };
    expect(prune.Env[0]).toBe(
      `KEEP=${A}-99887766.crt ${A}-99887766.key certs.yml`,
    );
    expect(prune.Env[0]).not.toContain('abcdef01');
  });
});
