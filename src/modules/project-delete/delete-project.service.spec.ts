import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DeleteProjectService } from './delete-project.service';

describe('DeleteProjectService', () => {
  const calls: string[] = [];

  const build = (
    opts: {
      failApp?: string;
      failDb?: string;
      failStack?: string;
      busyStack?: boolean;
      notAdmin?: boolean;
      startingDb?: boolean;
      registryFails?: boolean;
    } = {},
  ) => {
    calls.length = 0;
    const project = { id: 'p1', name: 'My Project' };
    const stacks = [{ id: 's1', name: 'stack', slug: 'stack-1' }];
    const apps = [
      { id: 'a1', name: 'one', appName: 'web-1', sourceType: 'git' },
      { id: 'a2', name: 'two', appName: 'api-2', sourceType: 'git' },
      { id: 'a3', name: 'pulled', appName: 'demo', sourceType: 'image' },
    ];
    const purgeRepositories = jest.fn((repos: string[]) => {
      calls.push(`registry:${repos.join(',')}`);
      return opts.registryFails
        ? Promise.reject(new Error('registry down'))
        : Promise.resolve({ deleted: repos, skipped: [], failed: [] });
    });
    const dbs = [
      {
        id: 'd1',
        name: 'db',
        slug: 'db-1',
        engine: 'postgres',
        status: opts.startingDb ? 'creating' : 'running',
      },
    ];
    const projectRepo = {
      remove: jest.fn(() => {
        calls.push('project.remove');
        return Promise.resolve();
      }),
    };
    const removeVolume = jest.fn((n: string) => {
      calls.push(`volume:${n}`);
      return Promise.resolve();
    });
    const svc = new DeleteProjectService(
      {
        findOwnedOrFail: jest.fn().mockResolvedValue(project),
        access: {
          assertAdmin: jest.fn(() =>
            opts.notAdmin
              ? Promise.reject(new ForbiddenException())
              : Promise.resolve(),
          ),
        },
        repo: projectRepo,
      } as never,
      {
        mounts: {
          find: jest.fn().mockResolvedValue([{ type: 'volume', name: 'data' }]),
        },
      } as never,
      {
        destroy: jest.fn((app: { id: string }, o: { purge?: boolean }) => {
          calls.push(`app:${app.id}:purge=${String(o.purge)}`);
          return app.id === opts.failApp
            ? Promise.reject(new BadGatewayException('daemon down'))
            : Promise.resolve();
        }),
      } as never,
      {
        remove: jest.fn((db: { id: string }, purge: boolean) => {
          calls.push(`db:${db.id}:purge=${String(purge)}`);
          return db.id === opts.failDb
            ? Promise.reject(new Error('ECONNREFUSED'))
            : Promise.resolve();
        }),
      } as never,
      {
        isActive: jest.fn(() => !!opts.busyStack),
        destroy: jest.fn(
          (stack: { id: string }, o: { keepVolumes?: boolean }) => {
            calls.push(`stack:${stack.id}:keep=${String(o.keepVolumes)}`);
            return stack.id === opts.failStack
              ? Promise.reject(new Error('compose down failed'))
              : Promise.resolve();
          },
        ),
      } as never,
      { engine: { removeVolume } } as never,
      { reloadAll: jest.fn(() => Promise.resolve()) } as never,
      { reloadAll: jest.fn(() => Promise.resolve()) } as never,
      { reloadAll: jest.fn(() => Promise.resolve()) } as never,
      {
        purgeDatabase: jest.fn((id: string) => {
          calls.push(`backups:${id}`);
          return Promise.resolve({
            localFiles: 0,
            remoteObjects: 0,
            failures: [],
          });
        }),
      } as never,
      { purgeRepositories } as never,
      { find: jest.fn().mockResolvedValue(apps) } as never,
      {
        find: jest.fn().mockResolvedValue(dbs),
        remove: jest.fn((d: { id: string }) => {
          calls.push(`db.row:${d.id}`);
          return Promise.resolve();
        }),
      } as never,
      {
        find: jest.fn().mockResolvedValue(stacks),
        remove: jest.fn((s: { id: string }) => {
          calls.push(`stack.row:${s.id}`);
          return Promise.resolve();
        }),
      } as never,
    );
    return { svc, projectRepo, removeVolume, purgeRepositories };
  };

  it('answers 409 naming a database that is still starting, touching nothing', async () => {
    const t = build({ startingDb: true });
    await expect(t.svc.execute('u', 'p1')).rejects.toThrow(
      /database "db" is still starting/,
    );
    await expect(t.svc.execute('u', 'p1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls).toEqual([]);
  });

  it('tears down stacks, apps, databases and then the project row, keeping volumes', async () => {
    const t = build();
    await t.svc.execute('u', 'p1');
    expect(calls).toEqual([
      'stack:s1:keep=true',
      'stack.row:s1',
      'app:a1:purge=false',
      'app:a2:purge=false',
      'app:a3:purge=false',
      'db:d1:purge=false',
      'db.row:d1',
      'project.remove',
    ]);
    expect(t.removeVolume).not.toHaveBeenCalled();
  });

  it('purge forwards the flag and drops mount volumes of stacks (databases do it in remove)', async () => {
    const t = build();
    await t.svc.execute('u', 'p1', true);
    expect(calls).toContain('stack:s1:keep=false');
    expect(calls).toContain('app:a1:purge=true');
    expect(calls).toContain('db:d1:purge=true');
    expect(t.removeVolume).toHaveBeenCalledWith('aoox_compose_stack_1_data');
    expect(t.removeVolume).toHaveBeenCalledWith('aoox_compose_stack_1_files');
    expect(calls.at(-1)).toBe('project.remove');
  });

  it('purge removes the database backup files before the database row; no purge keeps them', async () => {
    const kept = build();
    await kept.svc.execute('u', 'p1');
    expect(calls.some((c) => c.startsWith('backups:'))).toBe(false);

    const t = build();
    await t.svc.execute('u', 'p1', true);
    expect(calls.indexOf('backups:d1')).toBeGreaterThan(-1);
    expect(calls.indexOf('backups:d1')).toBeLessThan(
      calls.indexOf('db.row:d1'),
    );
  });

  it('purge removes the repositories aoox built for git apps, never the image app one', async () => {
    const t = build();
    await t.svc.execute('u', 'p1', true);
    expect(t.purgeRepositories).toHaveBeenCalledTimes(1);
    expect(t.purgeRepositories).toHaveBeenCalledWith([
      'my-project/web-1',
      'my-project/web-1-preview',
      'my-project/api-2',
      'my-project/api-2-preview',
    ]);
    // After every application is destroyed, before the project row goes.
    expect(
      calls.indexOf(
        'registry:my-project/web-1,my-project/web-1-preview,my-project/api-2,my-project/api-2-preview',
      ),
    ).toBeGreaterThan(calls.indexOf('app:a3:purge=true'));
  });

  it('without purge the registry is not touched', async () => {
    const t = build();
    await t.svc.execute('u', 'p1');
    expect(t.purgeRepositories).not.toHaveBeenCalled();
  });

  it('a registry failure never blocks the delete', async () => {
    const t = build({ registryFails: true });
    await expect(t.svc.execute('u', 'p1', true)).resolves.toBeUndefined();
    expect(calls.at(-1)).toBe('project.remove');
  });

  it('stops at the failing application and keeps the project', async () => {
    const t = build({ failApp: 'a2' });
    await expect(t.svc.execute('u', 'p1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(calls).toContain('app:a1:purge=false');
    expect(calls.some((c) => c.startsWith('db:'))).toBe(false);
    expect(t.projectRepo.remove).not.toHaveBeenCalled();
  });

  it('names a failing database in a 502 and keeps the project', async () => {
    const t = build({ failDb: 'd1' });
    await expect(t.svc.execute('u', 'p1')).rejects.toThrow(/database "db"/);
    expect(calls).not.toContain('db.row:d1');
    expect(t.projectRepo.remove).not.toHaveBeenCalled();
  });

  it('a failing stack stops before applications', async () => {
    const t = build({ failStack: 's1' });
    await expect(t.svc.execute('u', 'p1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(calls.some((c) => c.startsWith('app:'))).toBe(false);
    expect(t.projectRepo.remove).not.toHaveBeenCalled();
  });

  it('refuses while a compose action is running', async () => {
    const t = build({ busyStack: true });
    await expect(t.svc.execute('u', 'p1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls).toEqual([]);
  });

  it('non-admins cannot delete and nothing is touched', async () => {
    const t = build({ notAdmin: true });
    await expect(t.svc.execute('u', 'p1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(calls).toEqual([]);
  });
});
