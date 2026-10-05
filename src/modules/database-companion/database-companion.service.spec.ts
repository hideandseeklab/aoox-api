import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { encryptSecret } from '../docker/secret.util';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { companionContainerName } from './companion-names';
import { getCompanionTool } from './companion-tools';
import { DatabaseCompanion } from './database-companion.entity';
import {
  companionLabels,
  DatabaseCompanionService,
} from './database-companion.service';

const KEY = 'test-encryption-key';
const DB_PASSWORD = 'dbSecretPw123';

function makeDb(over: Partial<ManagedDatabase> = {}): ManagedDatabase {
  return {
    id: 'db-1',
    projectId: 'proj-1',
    slug: 'main-abc123',
    engine: 'mariadb',
    status: 'running',
    username: 'appuser',
    databaseName: 'appdb',
    project: { id: 'proj-1' },
    ...over,
  } as ManagedDatabase;
}

function makeService(
  opts: {
    existing?: Partial<DatabaseCompanion> | null;
    domainTaken?: boolean;
    proxyRunning?: boolean;
    role?: 'admin' | 'developer' | 'viewer' | null;
    containers?: Array<{ Id: string; State: string }>;
    portConflict?: boolean;
  } = {},
) {
  const rows: DatabaseCompanion[] = opts.existing
    ? [
        {
          id: 'c-1',
          databaseId: 'db-1',
          tool: 'adminer',
          status: 'running',
          errorMessage: null,
          host: null,
          https: false,
          hostPort: 9000,
          passwordEncrypted: null,
          createdAt: new Date(),
          ...opts.existing,
        } as DatabaseCompanion,
      ]
    : [];
  const repo = {
    findOne: jest.fn(() => Promise.resolve(rows[0] ?? null)),
    exists: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      if ('host' in where) return Promise.resolve(!!opts.domainTaken);
      return Promise.resolve(rows.length > 0);
    }),
    create: jest.fn((v: Partial<DatabaseCompanion>) => ({
      id: 'c-new',
      createdAt: new Date(),
      errorMessage: null,
      ...v,
    })),
    save: jest.fn((v: DatabaseCompanion) => {
      rows.push(v);
      return Promise.resolve(v);
    }),
    update: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => ({
      addSelect: () => ({
        where: () => ({ getOne: () => Promise.resolve(rows[0] ?? null) }),
      }),
    })),
  };
  const domains = {
    exists: jest.fn().mockResolvedValue(!!opts.domainTaken),
  };
  const databases = {
    encrypt: jest.fn((p: string) => encryptSecret(p, KEY)),
    password: jest.fn().mockResolvedValue(DB_PASSWORD),
  };
  const engine = {
    removeContainer: jest.fn().mockResolvedValue(undefined),
    createContainer: jest
      .fn<Promise<string>, [Record<string, unknown>, string?]>()
      .mockResolvedValue('cid'),
    startContainer: jest.fn().mockResolvedValue(undefined),
    putArchive: jest
      .fn<Promise<void>, [string, string, Buffer]>()
      .mockResolvedValue(undefined),
  };
  const docker = {
    engine,
    logConfig: undefined,
    ensureImage: jest.fn().mockResolvedValue(undefined),
    ensureNetwork: jest.fn().mockResolvedValue(undefined),
    findContainerByName: jest
      .fn()
      .mockResolvedValue(
        opts.containers && opts.containers.length
          ? { ...opts.containers[0], Names: ['/x'] }
          : null,
      ),
  };
  const proxy = {
    localSettings: {
      httpPort: 80,
      httpsPort: 443,
      acmeEmail: null,
      acmeStaging: false,
    },
    status: jest.fn().mockResolvedValue({ running: opts.proxyRunning ?? true }),
    provision: jest.fn().mockResolvedValue(undefined),
    labelsFor: jest.fn(
      (router: string, port: number, d: { host: string; https: boolean }[]) =>
        d.length
          ? {
              'traefik.enable': 'true',
              [`traefik.http.routers.${router}.rule`]: `Host(\`${d[0].host}\`)`,
            }
          : {},
    ),
  };
  const hostPorts = {
    assertFree: jest.fn(() =>
      opts.portConflict
        ? Promise.reject(
            new BadRequestException('Host port sudah dipakai: 9000'),
          )
        : Promise.resolve(),
    ),
  };
  const access = {
    roleFor: jest.fn().mockResolvedValue(opts.role ?? 'developer'),
  };
  const config = {
    getOrThrow: () => KEY,
    get: (k: string) =>
      ({ PUBLIC_IP: '203.0.113.9' })[k as 'PUBLIC_IP'] ?? undefined,
  };
  const service = new DatabaseCompanionService(
    repo as never,
    domains as never,
    databases as never,
    docker as never,
    proxy as never,
    hostPorts as never,
    access as never,
    config as never,
  );
  return { service, repo, docker, engine, proxy, hostPorts, access, rows };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('DatabaseCompanionService', () => {
  describe('create', () => {
    it('rejects a tool that does not support the engine', async () => {
      const { service } = makeService();
      await expect(
        service.create(makeDb({ engine: 'redis' }), {
          tool: 'adminer',
          hostPort: 9000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(makeDb({ engine: 'mongodb' }), {
          tool: 'pgadmin',
          hostPort: 9000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('needs a domain or a host port', async () => {
      const { service, repo } = makeService();
      await expect(
        service.create(makeDb(), { tool: 'adminer' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('needs a running database', async () => {
      const { service } = makeService();
      await expect(
        service.create(makeDb({ status: 'stopped' }), {
          tool: 'adminer',
          hostPort: 9000,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows one companion per database', async () => {
      const { service } = makeService({ existing: {} });
      await expect(
        service.create(makeDb(), {
          tool: 'adminer',
          hostPort: 9001,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a domain already used', async () => {
      const { service } = makeService({ domainTaken: true });
      await expect(
        service.create(makeDb(), {
          tool: 'adminer',
          host: 'db.example.com',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a host port collision with 400 and creates nothing', async () => {
      const { service, repo, hostPorts, docker } = makeService({
        portConflict: true,
      });
      await expect(
        service.create(makeDb(), {
          tool: 'adminer',
          hostPort: 9000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hostPorts.assertFree).toHaveBeenCalledWith([9000], docker);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('provisions the proxy for a domain when it is not running', async () => {
      const { service, proxy } = makeService({ proxyRunning: false });
      await service.create(makeDb(), {
        tool: 'adminer',
        host: 'DB.Example.com',
        https: true,
      });
      await flush();
      expect(proxy.provision).toHaveBeenCalledTimes(1);
    });

    it('leaves no row behind when provisioning the proxy fails', async () => {
      const { service, repo, proxy } = makeService({ proxyRunning: false });
      proxy.provision.mockRejectedValueOnce(new Error('port 80 busy'));
      await expect(
        service.create(makeDb(), {
          tool: 'adminer',
          host: 'db.example.com',
        }),
      ).rejects.toThrow('port 80 busy');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('leaves a running proxy alone and does not touch it for host-port access', async () => {
      const a = makeService({ proxyRunning: true });
      await a.service.create(makeDb(), {
        tool: 'adminer',
        host: 'db.example.com',
      });
      expect(a.proxy.provision).not.toHaveBeenCalled();
      const b = makeService({ proxyRunning: false });
      await b.service.create(makeDb(), {
        tool: 'adminer',
        hostPort: 9000,
      });
      expect(b.proxy.status).not.toHaveBeenCalled();
    });

    it('returns status creating, then running once provisioned', async () => {
      const { service, repo } = makeService();
      const view = await service.create(makeDb(), {
        tool: 'adminer',
        hostPort: 9000,
      });
      expect(view.status).toBe('creating');
      await flush();
      expect(repo.update).toHaveBeenCalledWith('c-new', {
        status: 'running',
        errorMessage: null,
      });
    });

    it('ends in error with the message when provisioning fails', async () => {
      const { service, repo, docker } = makeService();
      docker.ensureImage.mockRejectedValueOnce(new Error('pull failed'));
      await service.create(makeDb(), {
        tool: 'adminer',
        hostPort: 9000,
      });
      await flush();
      expect(repo.update).toHaveBeenCalledWith('c-new', {
        status: 'error',
        errorMessage: 'pull failed',
      });
    });

    it('stores an encrypted generated password only for tools without the database login', async () => {
      const a = makeService();
      await a.service.create(makeDb({ engine: 'mongodb' }), {
        tool: 'mongo-express',
        hostPort: 9000,
      });
      const saved = a.rows[0];
      expect(saved.passwordEncrypted).toBeTruthy();
      expect(saved.passwordEncrypted).not.toMatch(/^[A-Za-z0-9]{24}$/);
      const b = makeService();
      await b.service.create(makeDb(), {
        tool: 'adminer',
        hostPort: 9000,
      });
      expect(b.rows[0].passwordEncrypted).toBeNull();
    });
  });

  describe('container', () => {
    it('is named aoox-dbadmin-<slug>, on the aoox network, host only', async () => {
      const { service, engine, docker } = makeService();
      const db = makeDb();
      const row = {
        id: 'c-1',
        host: null,
        https: false,
        hostPort: 9000,
      } as DatabaseCompanion;
      await service.provision(row, db, getCompanionTool('adminer')!, null);
      expect(docker.ensureNetwork).toHaveBeenCalledWith('aoox');
      const [body, name] = engine.createContainer.mock.calls[0] as [
        { Image: string; HostConfig: Record<string, unknown> },
        string,
      ];
      expect(name).toBe(companionContainerName('main-abc123'));
      expect(body.Image).toBe('adminer:5.4.2');
      expect(body.HostConfig.NetworkMode).toBe('aoox');
      expect(body.HostConfig.PortBindings).toEqual({
        '8080/tcp': [{ HostPort: '9000' }],
      });
      expect(engine.startContainer).toHaveBeenCalledWith('cid');
    });

    it('never carries aoox.database / aoox.application and never the DB password in labels', async () => {
      const { service, engine, proxy } = makeService();
      const db = makeDb({ engine: 'mongodb' });
      const row = {
        id: 'c-1',
        host: 'db.example.com',
        https: true,
        hostPort: null,
      } as DatabaseCompanion;
      await service.provision(
        row,
        db,
        getCompanionTool('mongo-express')!,
        'adminPw',
      );
      const body = engine.createContainer.mock.calls[0][0] as {
        Labels: Record<string, string>;
        Env: string[];
      };
      expect(body.Labels['aoox.component']).toBe('companion');
      expect(body.Labels['aoox.companion']).toBe('db-1');
      expect(body.Labels['aoox.project']).toBe('proj-1');
      expect(body.Labels).not.toHaveProperty('aoox.database');
      expect(body.Labels).not.toHaveProperty('aoox.application');
      expect(body.Labels).not.toHaveProperty('aoox.compose');
      expect(body.Labels['com.docker.compose.project']).toBe('aoox');
      expect(JSON.stringify(body.Labels)).not.toContain(DB_PASSWORD);
      expect(JSON.stringify(body.Labels)).not.toContain('adminPw');
      // The DB password is only in env, where the tool needs it.
      expect(body.Env.join('\n')).toContain(DB_PASSWORD);
      expect(proxy.labelsFor).toHaveBeenCalledWith(
        'dbadmin-main-abc123',
        8081,
        [{ host: 'db.example.com', https: true }],
      );
      expect(body.Labels['traefik.enable']).toBe('true');
    });

    it('copies preloaded files into the container before starting it', async () => {
      const { service, engine } = makeService();
      await service.provision(
        { id: 'c-1', host: null, https: false, hostPort: 9000 } as never,
        makeDb({ engine: 'postgres' }),
        getCompanionTool('pgadmin')!,
        'adminPw',
      );
      expect(engine.putArchive).toHaveBeenCalledTimes(1);
      expect(engine.putArchive.mock.calls[0][1]).toBe('/pgadmin4');
      expect(engine.putArchive.mock.invocationCallOrder[0]).toBeLessThan(
        engine.startContainer.mock.invocationCallOrder[0],
      );
    });

    it('companionLabels is the single label set', () => {
      const labels = companionLabels(makeDb());
      expect(Object.keys(labels).sort()).toEqual([
        'aoox.companion',
        'aoox.component',
        'aoox.project',
        'com.docker.compose.oneoff',
        'com.docker.compose.project',
        'com.docker.compose.service',
      ]);
    });
  });

  describe('get', () => {
    it('returns null without a companion', async () => {
      const { service } = makeService();
      expect(await service.get(makeDb())).toBeNull();
    });

    it('builds the domain URL and omits the password', async () => {
      const { service } = makeService({
        existing: { host: 'db.example.com', https: true, hostPort: null },
        containers: [{ Id: 'x', State: 'running' }],
      });
      const view = await service.get(makeDb());
      expect(view?.url).toBe('https://db.example.com/');
      expect(view).not.toHaveProperty('password');
      expect(view?.username).toBeNull();
    });

    it('builds the host-port URL from PUBLIC_IP and preselects the Adminer driver', async () => {
      const { service } = makeService({
        existing: { hostPort: 9000 },
        containers: [{ Id: 'x', State: 'running' }],
      });
      expect((await service.get(makeDb()))?.url).toBe(
        'http://203.0.113.9:9000/',
      );
      expect((await service.get(makeDb({ engine: 'postgres' })))?.url).toBe(
        'http://203.0.113.9:9000/?pgsql=aoox-db-main-abc123',
      );
    });

    it('reports a missing container as error and a stopped one as stopped', async () => {
      const gone = makeService({ existing: {}, containers: [] });
      const v1 = await gone.service.get(makeDb());
      expect(v1?.status).toBe('error');
      expect(v1?.errorMessage).toMatch(/no longer exists/);
      expect(gone.repo.update).toHaveBeenCalled();

      const stopped = makeService({
        existing: {},
        containers: [{ Id: 'x', State: 'exited' }],
      });
      expect((await stopped.service.get(makeDb()))?.status).toBe('stopped');
    });

    it('keeps the real provisioning error when there is no container', async () => {
      const { service, repo } = makeService({
        existing: { status: 'error', errorMessage: 'pull failed' },
        containers: [],
      });
      const view = await service.get(makeDb());
      expect(view?.status).toBe('error');
      expect(view?.errorMessage).toBe('pull failed');
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('does not touch the container while still creating', async () => {
      const { service, docker } = makeService({
        existing: { status: 'creating' },
      });
      expect((await service.get(makeDb()))?.status).toBe('creating');
      expect(docker.findContainerByName).not.toHaveBeenCalled();
    });
  });

  describe('credentials', () => {
    it('returns the decrypted password and the tool username', async () => {
      const { service } = makeService({
        existing: {
          tool: 'redis-commander',
          passwordEncrypted: encryptSecret('genPw', KEY),
        },
      });
      expect(
        await service.credentials('u1', makeDb({ engine: 'redis' })),
      ).toEqual({ username: 'admin', password: 'genPw' });
    });

    it('returns nulls for database-login tools', async () => {
      const { service } = makeService({ existing: { tool: 'adminer' } });
      expect(await service.credentials('u1', makeDb())).toEqual({
        username: null,
        password: null,
      });
    });

    it('refuses viewers and 404s without a companion', async () => {
      const viewer = makeService({
        existing: { passwordEncrypted: encryptSecret('x', KEY) },
        role: 'viewer',
      });
      await expect(
        viewer.service.credentials('u1', makeDb()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const none = makeService();
      await expect(
        none.service.credentials('u1', makeDb()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('removes the container and the row', async () => {
      const { service, engine, repo } = makeService({
        existing: {},
        containers: [{ Id: 'cont-1', State: 'running' }],
      });
      await service.remove(makeDb());
      expect(engine.removeContainer).toHaveBeenCalledWith('cont-1', true);
      expect(repo.delete).toHaveBeenCalledWith('c-1');
    });

    it('404s when there is none', async () => {
      const { service } = makeService();
      await expect(service.remove(makeDb())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

/**
 * Decision: a companion may be reachable through a domain AND a published
 * host port at the same time, like an ordinary application. The domain wins
 * for the `url`; the host port stays published.
 */
describe('DatabaseCompanionService domain and host port together', () => {
  it('accepts both, saves both, and checks the host port', async () => {
    const { service, repo, hostPorts, docker } = makeService();
    const view = await service.create(makeDb(), {
      tool: 'adminer',
      host: 'db.example.com',
      https: true,
      hostPort: 9000,
    });
    expect(hostPorts.assertFree).toHaveBeenCalledWith([9000], docker);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'db.example.com',
        https: true,
        hostPort: 9000,
      }),
    );
    expect(view).toMatchObject({ host: 'db.example.com', hostPort: 9000 });
    // The domain is the address shown, not the IP:port.
    expect(view.url).toMatch(/^https:\/\/db\.example\.com/);
    expect(view.url).not.toContain('9000');
  });

  it('publishes the host port and carries the proxy labels on the same container', async () => {
    const { service, engine } = makeService();
    await service.provision(
      {
        id: 'c-1',
        host: 'db.example.com',
        https: false,
        hostPort: 9000,
      } as DatabaseCompanion,
      makeDb(),
      getCompanionTool('adminer')!,
      null,
    );
    const body = engine.createContainer.mock.calls[0][0] as {
      Labels: Record<string, string>;
      HostConfig: { PortBindings: Record<string, unknown> };
    };
    expect(body.HostConfig.PortBindings).toEqual({
      '8080/tcp': [{ HostPort: '9000' }],
    });
    expect(body.Labels['traefik.enable']).toBe('true');
  });
});
