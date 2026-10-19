import { ManagedDatabaseService } from './managed-database.service';
import { DockerEngineError } from '../docker/docker-engine.client';
import type { ManagedDatabase } from './managed-database.entity';

const db = {
  id: 'db1',
  projectId: 'p1',
  slug: 'main-abc',
  engine: 'postgres',
  variant: null,
  imageTag: '16',
  username: 'u',
  databaseName: 'd',
  hostPort: null,
  cpuMillicores: null,
  memoryMb: null,
} as unknown as ManagedDatabase;

function build(opts: { readyCode?: number; mounts?: object[] } = {}) {
  const calls: string[] = [];
  const update = jest.fn().mockResolvedValue(undefined);
  const engine = {
    createVolume: jest.fn(() => Promise.resolve()),
    removeContainer: jest.fn(() => Promise.resolve()),
    createContainer: jest.fn(() => {
      calls.push('create');
      return Promise.resolve('cid');
    }),
    startContainer: jest.fn(() => {
      calls.push('start');
      return Promise.resolve();
    }),
    removeVolume: jest.fn((name: string) => {
      calls.push(`rmvol:${name}`);
      return name === 'aoox_db_main_abc_gone'
        ? Promise.reject(new DockerEngineError(404, 'no such volume'))
        : Promise.resolve();
    }),
  };
  const docker = {
    engine,
    logConfig: undefined,
    ensureImage: jest.fn(() => Promise.resolve()),
    ensureNetwork: jest.fn(() => Promise.resolve()),
    findContainerByName: jest.fn(() => Promise.resolve(null)),
    runOnceWithOutput: jest.fn(() => {
      calls.push('ready-check');
      return Promise.resolve({
        code: opts.readyCode ?? 0,
        output:
          'The postgres server did not accept connections within 120 seconds\n',
      });
    }),
  };
  const svc = new ManagedDatabaseService(
    { update } as never,
    { find: jest.fn().mockResolvedValue(opts.mounts ?? []) } as never,
    docker as never,
    { getOrThrow: () => 'k' } as never,
    { connectIfActive: jest.fn(() => Promise.resolve()) } as never,
    {} as never,
  );
  return { svc, calls, update, engine, docker };
}

describe('ManagedDatabaseService readiness', () => {
  it('only marks the row running after the engine answered', async () => {
    const { svc, calls, update } = build();
    svc.provisionInBackground(db, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.indexOf('start')).toBeLessThan(calls.indexOf('ready-check'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('db1', {
      status: 'running',
      errorMessage: null,
    });
  });

  it('ends in error with a clear message when the engine never answers', async () => {
    const { svc, update } = build({ readyCode: 1 });
    svc.provisionInBackground(db, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    expect(update).toHaveBeenCalledTimes(1);
    const [, patch] = update.mock.calls[0] as [string, Record<string, string>];
    expect(patch.status).toBe('error');
    expect(patch.errorMessage).toMatch(
      /did not become ready within 120 seconds/,
    );
    expect(patch.errorMessage).not.toContain('pw');
  });

  it('passes credentials to the probe through env, not the script', async () => {
    const { svc, docker } = build();
    await svc.provision(db, 'secretpw');
    const body = (docker.runOnceWithOutput.mock.calls[0] as unknown[])[0] as {
      Entrypoint: string[];
      Env: string[];
    };
    expect(body.Env).toContain('DB_PASSWORD=secretpw');
    expect(body.Entrypoint.join(' ')).not.toContain('secretpw');
  });
});

describe('ManagedDatabaseService.remove purge', () => {
  const mounts = [
    { type: 'volume', name: 'extra' },
    { type: 'volume', name: 'gone' },
    { type: 'file', name: 'conf', content: 'x' },
    { type: 'bind', hostPath: '/srv/x' },
  ];

  it('purge removes the data, mount and files volumes (404 tolerated)', async () => {
    const { svc, calls } = build({ mounts });
    await svc.remove(db, true);
    expect(calls).toEqual([
      'rmvol:aoox_db_main_abc',
      'rmvol:aoox_db_main_abc_extra',
      'rmvol:aoox_db_main_abc_gone',
      'rmvol:aoox_db_main_abc_files',
    ]);
  });

  it('without purge every volume stays', async () => {
    const { svc, engine } = build({ mounts });
    await svc.remove(db, false);
    expect(engine.removeVolume).not.toHaveBeenCalled();
  });
});
