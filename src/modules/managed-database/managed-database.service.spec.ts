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

function build(
  opts: {
    readyCode?: number;
    mounts?: object[];
    rowExists?: () => boolean;
  } = {},
) {
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
    {
      update,
      exists: jest.fn(() => Promise.resolve(opts.rowExists?.() ?? true)),
    } as never,
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

describe('ManagedDatabaseService lifecycle', () => {
  it('removes anonymous volumes of the old container on re-provision and delete', async () => {
    const { svc, engine, docker } = build();
    docker.findContainerByName.mockResolvedValue({ Id: 'old' } as never);
    await svc.provision(db, 'pw');
    expect(engine.removeContainer).toHaveBeenCalledWith('old', true, true);
    engine.removeContainer.mockClear();
    await svc.remove(db, false);
    expect(engine.removeContainer).toHaveBeenCalledWith('old', true, true);
    // Without purge the named data volume stays.
    expect(engine.removeVolume).not.toHaveBeenCalled();
  });

  it('does not create a container when the row was deleted during the pull', async () => {
    const { svc, engine, update } = build({ rowExists: () => false });
    svc.provisionInBackground(db, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.createContainer).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled(); // nothing to mark on a gone row
    expect(engine.removeVolume).toHaveBeenCalledWith('aoox_db_main_abc');
  });

  it('removes what it created when the row disappears while starting', async () => {
    let calls = 0;
    const { svc, engine, update } = build({ rowExists: () => ++calls < 2 });
    svc.provisionInBackground(db, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.createContainer).toHaveBeenCalled();
    expect(engine.removeContainer).toHaveBeenCalledWith('cid', true, true);
    expect(update).not.toHaveBeenCalled();
  });

  it('moves rows left in creating by an API restart to error', async () => {
    const update = jest.fn().mockResolvedValue({ affected: 2 });
    const svc = new ManagedDatabaseService(
      { update } as never,
      {} as never,
      {} as never,
      { getOrThrow: () => 'k' } as never,
      {} as never,
      {} as never,
    );
    await svc.onApplicationBootstrap();
    expect(update).toHaveBeenCalledWith(
      { status: 'creating' },
      expect.objectContaining({
        status: 'error',
        errorMessage: expect.stringContaining(
          'interrupted by an API restart',
        ) as string,
      }),
    );
  });
});
