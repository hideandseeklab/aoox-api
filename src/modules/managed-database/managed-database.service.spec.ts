import { BadGatewayException, ConflictException } from '@nestjs/common';
import {
  INTERRUPTED_MESSAGE,
  ManagedDatabaseService,
  reprovisionTouchedContainer,
} from './managed-database.service';
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
    image?: object | null;
    legacyData?: boolean;
    /** The row as the database holds it (re-read before a wipe). */
    row?: object | null;
    inspectContainer?: object | null;
  } = {},
) {
  const calls: string[] = [];
  const update = jest.fn().mockResolvedValue(undefined);
  const engine = {
    inspectImage: jest.fn(() => Promise.resolve(opts.image ?? null)),
    inspectContainer: jest.fn(() =>
      Promise.resolve(opts.inspectContainer ?? null),
    ),
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
    runOnceWithOutput: jest.fn((body: { Image: string }) => {
      if (body.Image === 'busybox:stable') {
        calls.push('layout-check');
        return Promise.resolve({
          code: opts.legacyData ? 0 : 1,
          output: '',
        });
      }
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
      findOne: jest.fn(() =>
        Promise.resolve(opts.row === undefined ? { ...db } : opts.row),
      ),
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
    svc.provisionInBackground({ ...db }, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.indexOf('start')).toBeLessThan(calls.indexOf('ready-check'));
    expect(update).toHaveBeenCalledTimes(2);
    // The first successful readiness is recorded before the row goes running.
    expect(update).toHaveBeenNthCalledWith(1, 'db1', {
      readyAt: expect.any(Date) as Date,
    });
    expect(update).toHaveBeenNthCalledWith(2, 'db1', {
      status: 'running',
      errorMessage: null,
    });
  });

  it('ends in error with a clear message when the engine never answers', async () => {
    const { svc, update } = build({ readyCode: 1 });
    svc.provisionInBackground({ ...db }, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    // Never ready: readyAt is not recorded.
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
    await svc.provision({ ...db }, 'secretpw');
    const body = (docker.runOnceWithOutput.mock.calls[0] as unknown[])[0] as {
      Entrypoint: string[];
      Env: string[];
    };
    expect(body.Env).toContain('DB_PASSWORD=secretpw');
    expect(body.Entrypoint.join(' ')).not.toContain('secretpw');
  });
});

describe('ManagedDatabaseService PostgreSQL data path', () => {
  const pg18 = {
    Config: {
      Volumes: { '/var/lib/postgresql': {} },
      Env: ['PGDATA=/var/lib/postgresql/18/docker'],
    },
  };
  const pg17 = {
    Config: {
      Volumes: { '/var/lib/postgresql/data': {} },
      Env: ['PGDATA=/var/lib/postgresql/data'],
    },
  };
  const binds = (engine: { createContainer: jest.Mock }) =>
    (
      (engine.createContainer.mock.calls[0] as unknown[])[0] as {
        HostConfig: { Binds: string[] };
      }
    ).HostConfig.Binds;

  it('mounts the volume on the root the image declares for 18+', async () => {
    const { svc, engine } = build({ image: pg18 });
    await svc.provision({ ...db }, 'pw');
    expect(binds(engine)[0]).toBe('aoox_db_main_abc:/var/lib/postgresql');
  });

  it('keeps the legacy path for images up to 17 and for unknown images', async () => {
    for (const image of [pg17, null]) {
      const { svc, engine, calls } = build({ image });
      await svc.provision({ ...db }, 'pw');
      expect(binds(engine)[0]).toBe(
        'aoox_db_main_abc:/var/lib/postgresql/data',
      );
      expect(calls).not.toContain('layout-check');
    }
  });

  it('refuses an 18+ image on a volume that holds old-layout data', async () => {
    const { svc, engine } = build({ image: pg18, legacyData: true });
    await expect(svc.provision({ ...db }, 'pw')).rejects.toThrow(
      /old layout.*dump and restore/,
    );
    expect(engine.createContainer).not.toHaveBeenCalled();
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
    await svc.provision({ ...db }, 'pw');
    expect(engine.removeContainer).toHaveBeenCalledWith('old', true, true);
    engine.removeContainer.mockClear();
    await svc.remove(db, false);
    expect(engine.removeContainer).toHaveBeenCalledWith('old', true, true);
    // Without purge the named data volume stays.
    expect(engine.removeVolume).not.toHaveBeenCalled();
  });

  it('does not create a container when the row was deleted during the pull', async () => {
    const { svc, engine, update } = build({ rowExists: () => false });
    svc.provisionInBackground({ ...db }, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.createContainer).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled(); // nothing to mark on a gone row
    expect(engine.removeVolume).toHaveBeenCalledWith('aoox_db_main_abc');
  });

  it('removes what it created when the row disappears while starting', async () => {
    let calls = 0;
    const { svc, engine, update } = build({ rowExists: () => ++calls < 2 });
    svc.provisionInBackground({ ...db }, 'pw');
    await new Promise((r) => setTimeout(r, 20));
    expect(engine.createContainer).toHaveBeenCalled();
    expect(engine.removeContainer).toHaveBeenCalledWith('cid', true, true);
    // Only the readiness mark; the row never goes running.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('db1', {
      readyAt: expect.any(Date) as Date,
    });
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

describe('ManagedDatabaseService.reprovision', () => {
  const pg18 = {
    Config: {
      Volumes: { '/var/lib/postgresql': {} },
      Env: ['PGDATA=/var/lib/postgresql/18/docker'],
    },
  };

  it('maps a readiness failure to 502 with the message and sets the row to error', async () => {
    const { svc, update } = build({ readyCode: 1 });
    const err = await svc.reprovision({ ...db }, 'pw').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as Error).message).toMatch(/did not become ready/);
    expect(update).toHaveBeenCalledWith('db1', {
      status: 'error',
      errorMessage: expect.stringMatching(/did not become ready/) as string,
    });
  });

  it('keeps the 409 layout guard unchanged and leaves the row alone', async () => {
    const { svc, update } = build({ image: pg18, legacyData: true });
    await expect(svc.reprovision({ ...db }, 'pw')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('maps a Docker failure before anything was touched to 502 without writing error', async () => {
    const { svc, update, docker } = build();
    docker.ensureImage.mockRejectedValueOnce(new Error('pull failed'));
    await expect(svc.reprovision({ ...db }, 'pw')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('writes error when create fails after the old container was removed', async () => {
    const { svc, update, docker, engine } = build();
    docker.findContainerByName.mockResolvedValue({ Id: 'old' } as never);
    engine.createContainer.mockRejectedValueOnce(new Error('no space'));
    await expect(svc.reprovision({ ...db }, 'pw')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(update).toHaveBeenCalledWith('db1', {
      status: 'error',
      errorMessage: 'no space',
    });
  });

  it('stops a stopped database again on success and does not touch the row', async () => {
    const { svc, update, docker, engine } = build();
    const stopContainer = jest.fn(() => Promise.resolve());
    (engine as unknown as Record<string, unknown>).stopContainer =
      stopContainer;
    docker.findContainerByName.mockResolvedValue({ Id: 'c' } as never);
    await svc.reprovision(
      { ...db, status: 'stopped', readyAt: new Date() } as never,
      'pw',
    );
    expect(stopContainer).toHaveBeenCalledWith('c');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('reprovisionTouchedContainer', () => {
  it('is false before the old container was touched and true after', async () => {
    const a = build();
    a.docker.ensureImage.mockRejectedValueOnce(new Error('pull failed'));
    const before = await a.svc
      .reprovision({ ...db }, 'pw')
      .catch((e: unknown) => e);
    expect(reprovisionTouchedContainer(before)).toBe(false);

    const b = build();
    b.engine.createContainer.mockRejectedValueOnce(new Error('no space'));
    const after = await b.svc
      .reprovision({ ...db }, 'pw')
      .catch((e: unknown) => e);
    expect(reprovisionTouchedContainer(after)).toBe(true);

    const c = build({
      image: {
        Config: {
          Volumes: { '/var/lib/postgresql': {} },
          Env: ['PGDATA=/var/lib/postgresql/18/docker'],
        },
      },
      legacyData: true,
    });
    const layout = await c.svc
      .reprovision({ ...db }, 'pw')
      .catch((e: unknown) => e);
    expect(reprovisionTouchedContainer(layout)).toBe(false);
    expect(reprovisionTouchedContainer(new Error('x'))).toBe(false);
    expect(reprovisionTouchedContainer(undefined)).toBe(false);
  });
});

describe('ManagedDatabaseService.retryProvisioning', () => {
  it('refuses a database that is not in error', async () => {
    const { svc, update } = build();
    for (const status of ['running', 'stopped', 'creating']) {
      await expect(
        svc.retryProvisioning({ ...db, status } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a row the boot recovery marked as interrupted', async () => {
    const { svc, update } = build();
    await expect(
      svc.retryProvisioning({
        ...db,
        status: 'error',
        errorMessage: INTERRUPTED_MESSAGE,
      } as never),
    ).rejects.toThrow(/interrupted by an API restart/);
    expect(update).not.toHaveBeenCalled();
  });

  it('sets creating, then running and clears the message when the provision succeeds', async () => {
    const { svc, update, engine } = build();
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    const out = await svc.retryProvisioning({
      ...db,
      status: 'error',
      errorMessage: 'old failure',
    } as never);
    expect(out.status).toBe('creating');
    expect(update).toHaveBeenNthCalledWith(1, 'db1', {
      status: 'creating',
      errorMessage: null,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(update).toHaveBeenLastCalledWith('db1', {
      status: 'running',
      errorMessage: null,
    });
    // Unknown history (no tracking): the data volume is only (re)created, never removed.
    expect(engine.createVolume).toHaveBeenCalledWith('aoox_db_main_abc');
    expect(engine.removeVolume).not.toHaveBeenCalled();
  });

  it('ends in error with the new message when it fails again', async () => {
    const { svc, update, docker } = build();
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    docker.ensureImage.mockRejectedValueOnce(new Error('pull failed'));
    await svc.retryProvisioning({ ...db, status: 'error' } as never);
    await new Promise((r) => setTimeout(r, 30));
    expect(update).toHaveBeenLastCalledWith('db1', {
      status: 'error',
      errorMessage: 'pull failed',
    });
  });
});

describe('ManagedDatabaseService.retryProvisioning volume handling', () => {
  const tracked = { ...db, status: 'error', historyTracked: true };
  const wait = () => new Promise((r) => setTimeout(r, 40));

  it('recreates the data and mount volumes of a tracked database that never became ready', async () => {
    const { svc, engine, docker, calls } = build({
      row: { ...tracked, readyAt: null },
    });
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    docker.findContainerByName.mockResolvedValueOnce({ Id: 'old' } as never);
    const mounts = (svc as unknown as { mounts: { find: jest.Mock } }).mounts;
    mounts.find.mockResolvedValue([
      { type: 'volume', name: 'conf', containerPath: '/etc/x' },
    ]);
    await svc.retryProvisioning({ ...tracked, readyAt: null } as never);
    await wait();
    expect(engine.removeContainer).toHaveBeenCalledWith('old', true, true);
    expect(engine.removeVolume).toHaveBeenCalledWith('aoox_db_main_abc');
    expect(engine.removeVolume).toHaveBeenCalledWith('aoox_db_main_abc_conf');
    expect(engine.removeVolume).toHaveBeenCalledWith('aoox_db_main_abc_files');
    // Wiped before it is created again.
    expect(calls.indexOf('rmvol:aoox_db_main_abc')).toBeLessThan(
      calls.indexOf('create'),
    );
    expect(engine.createVolume).toHaveBeenCalledWith('aoox_db_main_abc');
  });

  it('ignores a volume that is already gone', async () => {
    const { svc, update, engine } = build({
      row: { ...tracked, readyAt: null },
    });
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    engine.removeVolume.mockRejectedValue(
      new DockerEngineError(404, 'no such volume'),
    );
    await svc.retryProvisioning({ ...tracked, readyAt: null } as never);
    await wait();
    expect(update).toHaveBeenLastCalledWith('db1', {
      status: 'running',
      errorMessage: null,
    });
  });

  it('never removes the volume of a database that was ever ready', async () => {
    const readyAt = new Date();
    const { svc, engine } = build({ row: { ...tracked, readyAt } });
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    await svc.retryProvisioning({ ...tracked, readyAt } as never);
    await wait();
    expect(engine.removeVolume).not.toHaveBeenCalled();
  });

  it('never removes the volume of a row with unknown history', async () => {
    const { svc, engine } = build();
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    await svc.retryProvisioning({
      ...db,
      status: 'error',
      historyTracked: false,
      readyAt: null,
    } as never);
    await wait();
    expect(engine.removeVolume).not.toHaveBeenCalled();
  });

  it('re-reads the row and refuses to wipe when it became ready meanwhile', async () => {
    const { svc, engine, update } = build({
      row: { ...tracked, readyAt: new Date() },
    });
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    // The caller's copy is stale: it still says never ready.
    await svc.retryProvisioning({ ...tracked, readyAt: null } as never);
    await wait();
    expect(engine.removeVolume).not.toHaveBeenCalled();
    expect(engine.createContainer).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith('db1', {
      status: 'error',
      errorMessage: expect.stringMatching(/may hold data/) as string,
    });
  });

  it('a wipe failure ends in error and creates nothing', async () => {
    const { svc, engine, update } = build({
      row: { ...tracked, readyAt: null },
    });
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    engine.removeVolume.mockRejectedValue(new DockerEngineError(409, 'in use'));
    await svc.retryProvisioning({ ...tracked, readyAt: null } as never);
    await wait();
    expect(engine.createContainer).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith('db1', {
      status: 'error',
      errorMessage: expect.stringMatching(/in use/) as string,
    });
  });

  it('records readyAt the first time the retry succeeds', async () => {
    const { svc, update } = build({ row: { ...tracked, readyAt: null } });
    jest.spyOn(svc, 'password').mockResolvedValue('pw');
    await svc.retryProvisioning({ ...tracked, readyAt: null } as never);
    await wait();
    expect(update).toHaveBeenCalledWith('db1', {
      readyAt: expect.any(Date) as Date,
    });
  });
});

describe('ManagedDatabaseService.dataMountPath', () => {
  const pg18 = {
    Config: {
      Volumes: { '/var/lib/postgresql': {} },
      Env: ['PGDATA=/var/lib/postgresql/18/docker'],
    },
  };

  it('reads the real mount of the data volume from the container', async () => {
    const { svc, docker } = build({
      inspectContainer: {
        Mounts: [
          { Name: 'other', Destination: '/x' },
          { Name: 'aoox_db_main_abc', Destination: '/var/lib/postgresql' },
        ],
      },
    });
    docker.findContainerByName.mockResolvedValue({ Id: 'c' } as never);
    await expect(svc.dataMountPath(db)).resolves.toBe('/var/lib/postgresql');
  });

  it('falls back to the image layout (PostgreSQL 18) without a container', async () => {
    const { svc } = build({ image: pg18 });
    await expect(svc.dataMountPath(db)).resolves.toBe('/var/lib/postgresql');
  });

  it('uses the engine recipe for other engines', async () => {
    const { svc } = build();
    await expect(
      svc.dataMountPath({ ...db, engine: 'mysql' } as never),
    ).resolves.toBe('/var/lib/mysql');
  });

  it('is null when nothing can be told', async () => {
    const { svc, docker } = build();
    docker.findContainerByName.mockRejectedValue(new Error('daemon down'));
    await expect(svc.dataMountPath(db)).resolves.toBeNull();
    const none = build({ image: null });
    await expect(none.svc.dataMountPath(db)).resolves.toBeNull();
  });
});
