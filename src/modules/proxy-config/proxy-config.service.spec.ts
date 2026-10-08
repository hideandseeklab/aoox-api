import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProxyConfigService } from './proxy-config.service';
import { ProxyConfigFile } from './proxy-config.entity';
import type { SyncReport } from './proxy-config-sync.service';

const doc = (name: string, extra = '') =>
  `http:\n  middlewares:\n    ${name}:\n      headers:\n        frameDeny: true\n${extra}`;
const OK: SyncReport = {
  files: 1,
  proxy: 'running',
  proxyRecreated: false,
  errors: [],
  verified: true,
  warning: null,
  notice: null,
};

function make(
  opts: {
    domains?: Array<{
      host: string;
      middlewares: string[];
      serverId?: string | null;
    }>;
    syncImpl?: (
      serverId: string | null,
      verify?: unknown,
    ) => Promise<SyncReport>;
    needsRecreate?: boolean;
  } = {},
) {
  const store: ProxyConfigFile[] = [];
  let n = 0;
  const files = {
    find: jest.fn((q: { where: Record<string, unknown> }) =>
      Promise.resolve(
        store
          .filter((r) => {
            const sid = q.where.serverId;
            const sidOk =
              typeof sid === 'string'
                ? r.serverId === sid
                : r.serverId === null;
            const enOk =
              q.where.enabled === undefined || r.enabled === q.where.enabled;
            return sidOk && enOk;
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    ),
    count: jest.fn((q: { where: Record<string, unknown> }) =>
      Promise.resolve(
        store.filter((r) => {
          const sid = q.where.serverId;
          return (
            (typeof sid === 'string'
              ? r.serverId === sid
              : r.serverId === null) &&
            (q.where.enabled === undefined || r.enabled === q.where.enabled)
          );
        }).length,
      ),
    ),
    findOne: jest.fn((q: { where: { id: string } }) =>
      Promise.resolve(store.find((r) => r.id === q.where.id) ?? null),
    ),
    exists: jest.fn((q: { where: { name: string; serverId: unknown } }) =>
      Promise.resolve(
        store.some(
          (r) =>
            r.name === q.where.name &&
            (typeof q.where.serverId === 'string'
              ? r.serverId === q.where.serverId
              : r.serverId === null),
        ),
      ),
    ),
    create: jest.fn(
      (v: Partial<ProxyConfigFile>) => ({ ...v }) as ProxyConfigFile,
    ),
    save: jest.fn((r: ProxyConfigFile) => {
      if (!r.id) {
        r.id = `id-${++n}`;
        r.createdAt = new Date();
      }
      r.updatedAt = new Date();
      const i = store.findIndex((x) => x.id === r.id);
      if (i >= 0) store[i] = r;
      else store.push(r);
      return Promise.resolve(r);
    }),
    delete: jest.fn((id: string) => {
      const i = store.findIndex((x) => x.id === id);
      if (i >= 0) store.splice(i, 1);
      return Promise.resolve();
    }),
  };
  const domainRows = opts.domains ?? [];
  const domains = {
    createQueryBuilder: jest.fn(() => {
      let refs: string[] | null = null;
      let server: string | null = null;
      const qb: Record<string, jest.Mock> = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn((sql: string, p?: { refs: string[] }) => {
          if (p?.refs) refs = p.refs;
          return qb;
        }),
        andWhere: jest.fn((_sql: string, p?: { serverId: string }) => {
          server = p?.serverId ?? null;
          return qb;
        }),
        getMany: jest.fn(() =>
          Promise.resolve(
            domainRows
              .filter((d) => (d.serverId ?? null) === server)
              .filter(
                (d) =>
                  refs === null ||
                  d.middlewares.some((m) => (refs as string[]).includes(m)),
              )
              .filter((d) => refs !== null || d.middlewares.length > 0),
          ),
        ),
      };
      return qb;
    }),
  };
  const sync = {
    sync: jest.fn(opts.syncImpl ?? (() => Promise.resolve(OK))),
    state: jest.fn().mockResolvedValue({
      proxy: 'running',
      fileProvider: !opts.needsRecreate,
      needsRecreate: opts.needsRecreate ?? false,
    }),
  };
  const servers = { findOrFail: jest.fn().mockResolvedValue({ id: 'srv1' }) };
  const svc = new ProxyConfigService(
    files as never,
    domains as never,
    sync as never,
    servers as never,
  );
  return { svc, store, files, sync, servers };
}

describe('ProxyConfigService', () => {
  it('creates a file: validates, saves, syncs with the elements to verify', async () => {
    const t = make();
    const r = await t.svc.create(null, 'hdrs', doc('hdrs'), true);
    expect(r.file).toMatchObject({
      name: 'hdrs',
      fileName: 'user-hdrs.yml',
      enabled: true,
      middlewares: ['hdrs'],
      usedByDomains: 0,
    });
    expect(r.sync).toBe(OK);
    expect(t.store).toHaveLength(1);
    expect(t.sync.sync).toHaveBeenCalledWith(null, {
      name: 'hdrs',
      refs: ['hdrs@file'],
    });
  });

  it('a disabled file is stored and synced without verification', async () => {
    const t = make();
    await t.svc.create(null, 'off', doc('off'), false);
    expect(t.sync.sync).toHaveBeenCalledWith(null, undefined);
  });

  it('refuses invalid content with the validation messages and stores nothing', async () => {
    const t = make();
    await expect(
      t.svc.create(null, 'bad', 'tcp:\n  routers: {}', true),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.store).toHaveLength(0);
    expect(t.sync.sync).not.toHaveBeenCalled();
  });

  it('refuses a duplicate name per proxy, but allows the same name on another server', async () => {
    const t = make();
    await t.svc.create(null, 'a', doc('m1'), true);
    await expect(
      t.svc.create(null, 'a', doc('m2'), true),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.svc.create('srv1', 'a', doc('m1'), true),
    ).resolves.toBeDefined();
  });

  it('refuses an element name already declared by another enabled file on that proxy', async () => {
    const t = make();
    await t.svc.create(null, 'a', doc('shared'), true);
    await expect(t.svc.create(null, 'b', doc('shared'), true)).rejects.toThrow(
      /already declared in the file "a"/,
    );
    // a disabled file does not count; another server does not either
    await expect(
      t.svc.create('srv1', 'c', doc('shared'), true),
    ).resolves.toBeDefined();
  });

  it('checks the server exists for remote files', async () => {
    const t = make();
    t.servers.findOrFail.mockRejectedValueOnce(
      new NotFoundException('Server not found'),
    );
    await expect(
      t.svc.create('missing', 'a', doc('x'), true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('when Traefik reports an error: rolls the new file back and answers 400 with the error', async () => {
    const calls: unknown[] = [];
    const t = make({
      syncImpl: (_s, verify) => {
        calls.push(verify);
        return Promise.resolve(
          verify
            ? {
                ...OK,
                verified: false,
                errors: ['level=error msg="boom hdrs@file"'],
              }
            : OK,
        );
      },
    });
    await expect(t.svc.create(null, 'hdrs', doc('hdrs'), true)).rejects.toThrow(
      /Traefik rejected the file.*boom/,
    );
    expect(t.store).toHaveLength(0);
    // verified sync, then a plain resync that removes the file from the volume
    expect(calls).toEqual([{ name: 'hdrs', refs: ['hdrs@file'] }, undefined]);
  });

  it('when Traefik rejects an update: restores the previous content and enabled flag', async () => {
    let reject = false;
    const t = make({
      syncImpl: (_s, verify) =>
        Promise.resolve(
          reject && verify ? { ...OK, errors: ['level=error user-a.yml'] } : OK,
        ),
    });
    const created = await t.svc.create(null, 'a', doc('m1'), true);
    reject = true;
    await expect(
      t.svc.update(created.file.id, {
        content: doc('m1').replace('true', 'false'),
      }),
    ).rejects.toThrow(/previous version was restored/);
    expect(t.store[0].content).toBe(doc('m1'));
    expect(t.store[0].enabled).toBe(true);
  });

  it('an unreachable daemon reverts the change and answers 502', async () => {
    const t = make({
      syncImpl: (_s, verify) =>
        verify ? Promise.reject(new Error('ssh down')) : Promise.resolve(OK),
    });
    await expect(
      t.svc.create(null, 'a', doc('m1'), true),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(t.store).toHaveLength(0);
  });

  it('update: content and/or enabled; verification only when something becomes live', async () => {
    const t = make();
    const c = await t.svc.create(null, 'a', doc('m1'), true);
    t.sync.sync.mockClear();
    await t.svc.update(c.file.id, { enabled: false });
    expect(t.sync.sync).toHaveBeenLastCalledWith(null, undefined);
    await t.svc.update(c.file.id, { enabled: true });
    expect(t.sync.sync).toHaveBeenLastCalledWith(null, {
      name: 'a',
      refs: ['m1@file'],
    });
    await expect(
      t.svc.update('nope', { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to disable, rewrite away or delete a middleware a domain uses (409 naming the domain)', async () => {
    const t = make({
      domains: [{ host: 'app.example.com', middlewares: ['m1@file'] }],
    });
    const c = await t.svc.create(null, 'a', doc('m1'), true);
    await expect(t.svc.update(c.file.id, { enabled: false })).rejects.toThrow(
      /app\.example\.com.*m1@file/,
    );
    await expect(
      t.svc.update(c.file.id, { content: doc('renamed') }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(t.svc.remove(c.file.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.store).toHaveLength(1);
    // changing other parts of the same middleware is fine
    await expect(
      t.svc.update(c.file.id, {
        content: doc('m1', '    other:\n      headers: {}\n'),
      }),
    ).resolves.toBeDefined();
  });

  it('a domain on another proxy does not block the file', async () => {
    const t = make({
      domains: [
        { host: 'x.example.com', middlewares: ['m1@file'], serverId: 'srv1' },
      ],
    });
    const c = await t.svc.create(null, 'a', doc('m1'), true);
    await expect(t.svc.remove(c.file.id)).resolves.toBe(OK);
    expect(t.store).toHaveLength(0);
  });

  it('delete puts the row back when the proxy could not be updated', async () => {
    let fail = false;
    const t = make({
      syncImpl: () =>
        fail ? Promise.reject(new Error('down')) : Promise.resolve(OK),
    });
    const c = await t.svc.create(null, 'a', doc('m1'), true);
    fail = true;
    await expect(t.svc.remove(c.file.id)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(t.store).toHaveLength(1);
  });

  it('lists middlewares of enabled files only, per proxy', async () => {
    const t = make();
    await t.svc.create(null, 'a', doc('m1'), true);
    await t.svc.create(null, 'b', doc('m2'), false);
    await t.svc.create('srv1', 'c', doc('m3'), true);
    expect(await t.svc.availableMiddlewares(null)).toEqual([
      { ref: 'm1@file', file: 'a' },
    ]);
    expect(await t.svc.availableMiddlewares('srv1')).toEqual([
      { ref: 'm3@file', file: 'c' },
    ]);
    await expect(
      t.svc.assertMiddlewaresExist(null, ['m1@file']),
    ).resolves.toBeUndefined();
    await expect(
      t.svc.assertMiddlewaresExist(null, ['m2@file']),
    ).rejects.toThrow(/does not exist/);
    await expect(
      t.svc.assertMiddlewaresExist(null, ['m3@file']),
    ).rejects.toThrow(/does not exist/);
  });

  it('list reports how many domains use each file', async () => {
    const t = make({
      domains: [
        { host: 'a.example.com', middlewares: ['m1@file'] },
        { host: 'b.example.com', middlewares: ['m1@file', 'zz@file'] },
        { host: 'c.example.com', middlewares: [] },
      ],
    });
    await t.svc.create(null, 'a', doc('m1'), true);
    const [item] = await t.svc.list(null);
    expect(item.usedByDomains).toBe(2);
    expect(item.size).toBeGreaterThan(0);
  });

  it('resync delegates to the sync service and maps a failure to 502', async () => {
    const ok = make();
    await expect(ok.svc.resync('srv1')).resolves.toBe(OK);
    const bad = make({ syncImpl: () => Promise.reject(new Error('x')) });
    await expect(bad.svc.resync(null)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('asks for consent before recreating an old proxy, once, and not again afterwards', async () => {
    const t = make({ needsRecreate: true });
    await expect(
      t.svc.create(null, 'a', doc('m1'), true),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'proxy-restart-required' },
    });
    expect(t.store).toHaveLength(0);
    expect(t.sync.sync).not.toHaveBeenCalled();
    await expect(
      t.svc.create(null, 'a', doc('m1'), true, true),
    ).resolves.toBeDefined();
    // a disabled file never recreates anything, so no consent is needed
    await expect(
      t.svc.create(null, 'b', doc('m2'), false),
    ).resolves.toBeDefined();
  });

  it('update and resync need the same consent when the proxy would be recreated', async () => {
    const t = make({ needsRecreate: true });
    const off = await t.svc.create(null, 'a', doc('m1'), false);
    await expect(
      t.svc.update(off.file.id, { enabled: true }),
    ).rejects.toMatchObject({
      response: { code: 'proxy-restart-required' },
    });
    await expect(
      t.svc.update(off.file.id, { enabled: true, acceptProxyRestart: true }),
    ).resolves.toBeDefined();
    await expect(t.svc.resync(null)).rejects.toMatchObject({
      response: { code: 'proxy-restart-required' },
    });
    await expect(t.svc.resync(null, true)).resolves.toBe(OK);
  });

  it('a proxy that already loads the directory is never asked about', async () => {
    const t = make({ needsRecreate: false });
    await expect(
      t.svc.create(null, 'a', doc('m1'), true),
    ).resolves.toBeDefined();
    expect(await t.svc.state(null)).toMatchObject({ needsRecreate: false });
  });
});
