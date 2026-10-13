import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ProjectRole } from '../project/project-member.entity';
import { Project } from '../project/project.entity';
import type { ProjectRoles } from './variable-set-access.service';
import { VariableSetAccessService } from './variable-set-access.service';
import type { EnvironmentUser } from './variable-set-environment.service';
import { VariableSetProject } from './variable-set-project.entity';
import { VariableSetService } from './variable-set.service';

function valueIn(actual: unknown, expected: unknown): boolean {
  const op = expected as { _type?: string; _value?: unknown[] } | null;
  if (op && typeof op === 'object' && op._type === 'in') {
    return (op._value ?? []).includes(actual);
  }
  return actual === expected;
}

const PROJECTS = [
  { id: 'p1', name: 'Shop' },
  { id: 'p2', name: 'Blog' },
];

/** Per user: platform flag and project roles (`all` = unscoped instance admin). */
const PEOPLE: Record<string, ProjectRoles> = {
  root: { platform: true, roles: 'all' },
  dev: {
    platform: false,
    roles: new Map<string, ProjectRole>([['p1', 'developer']]),
  },
  view: {
    platform: false,
    roles: new Map<string, ProjectRole>([['p1', 'viewer']]),
  },
  outsider: { platform: false, roles: new Map() },
};

function build() {
  let n = 0;
  const sets: Array<Record<string, unknown>> = [
    {
      id: 's1',
      name: 'Shop',
      slug: 'shop',
      description: null,
      sharedWithAll: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 's2',
      name: 'Blog secrets',
      slug: 'blog',
      description: null,
      sharedWithAll: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 's3',
      name: 'Common',
      slug: 'common',
      description: null,
      sharedWithAll: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const shares: Array<{ variableSetId: string; projectId: string }> = [
    { variableSetId: 's1', projectId: 'p1' },
    { variableSetId: 's1', projectId: 'p2' },
    { variableSetId: 's2', projectId: 'p2' },
  ];
  const envs = [
    {
      id: 'e1',
      variableSetId: 's1',
      name: 'production',
      protected: true,
      keys: ['A'],
      updatedAt: new Date(),
    },
    {
      id: 'e2',
      variableSetId: 's2',
      name: 'development',
      protected: false,
      keys: [],
      updatedAt: new Date(),
    },
    {
      id: 'e3',
      variableSetId: 's3',
      name: 'staging',
      protected: false,
      keys: ['X', 'Y'],
      updatedAt: new Date(),
    },
  ];
  const users = new Map<string, EnvironmentUser[]>();
  const matches = (r: object, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      valueIn((r as Record<string, unknown>)[k], v),
    );
  const manager = {
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
    create: (_: unknown, v: object) => ({ ...v }),
    save: (v: Record<string, unknown>) => {
      const row = {
        id: `s-new-${++n}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...v,
      };
      sets.push(row);
      return Promise.resolve(row);
    },
    insert: (entity: unknown, rows: unknown) => {
      if (entity === VariableSetProject) {
        shares.push(...(rows as typeof shares));
      }
      return Promise.resolve();
    },
    update: (_: unknown, where: { id: string }, patch: object) => {
      Object.assign(
        sets.find((s) => s.id === where.id)!,
        patch,
      );
      return Promise.resolve();
    },
    delete: (entity: unknown, where: { variableSetId: string }) => {
      if (entity === VariableSetProject) {
        for (let i = shares.length - 1; i >= 0; i--) {
          if (shares[i].variableSetId === where.variableSetId)
            shares.splice(i, 1);
        }
      }
      return Promise.resolve();
    },
    find: (entity: unknown, o: { where: Record<string, unknown> }) =>
      Promise.resolve(
        entity === Project ? PROJECTS.filter((p) => matches(p, o.where)) : [],
      ),
  };
  const setRepo = {
    // Ordered by name, like the real query.
    find: () =>
      Promise.resolve(
        [...sets].sort((a, b) => String(a.name).localeCompare(String(b.name))),
      ),
    findOne: ({ where }: { where: { id: string } }) =>
      Promise.resolve(sets.find((s) => s.id === where.id) ?? null),
    exists: ({ where }: { where: { slug: string } }) =>
      Promise.resolve(sets.some((s) => s.slug === where.slug)),
    save: (v: object) => Promise.resolve(v),
    delete: ({ id }: { id: string }) => {
      sets.splice(
        sets.findIndex((s) => s.id === id),
        1,
      );
      return Promise.resolve();
    },
    manager,
  };
  const shareRepo = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(shares.filter((s) => matches(s, where))),
  };
  const projectAccess = {
    projectRoles: (userId: string) => Promise.resolve(PEOPLE[userId]),
  };
  const access = new VariableSetAccessService(
    setRepo as never,
    shareRepo as never,
    projectAccess as never,
  );
  const environments = {
    repo: {
      find: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(envs.filter((e) => matches(e, where))),
    },
    listOf: (setId: string) =>
      Promise.resolve(envs.filter((e) => e.variableSetId === setId)),
    views: (list: typeof envs) =>
      Promise.resolve(
        list.map((e) => ({ ...e, usedBy: users.get(e.id) ?? [] })),
      ),
    ensureDefaults: jest.fn().mockResolvedValue(undefined),
    usersOf: (ids: string[], ctx: ProjectRoles | 'all') =>
      Promise.resolve(
        new Map(
          ids.map((id) => [
            id,
            (users.get(id) ?? []).filter(
              (u) =>
                ctx === 'all' ||
                ctx.roles === 'all' ||
                ctx.roles.has(u.projectId),
            ),
          ]),
        ),
      ),
  };
  const projects = {
    findOwnedOrFail: (projectId: string, userId: string) => {
      const ctx = PEOPLE[userId];
      if (ctx.roles !== 'all' && !ctx.roles.has(projectId)) {
        return Promise.reject(new NotFoundException('Project not found'));
      }
      return Promise.resolve(PROJECTS.find((p) => p.id === projectId));
    },
  };
  const svc = new VariableSetService(
    access,
    environments as never,
    projects as never,
  );
  const link = (envId: string, u: Partial<EnvironmentUser>) =>
    users.set(envId, [
      ...(users.get(envId) ?? []),
      {
        kind: 'application',
        id: 'a1',
        name: 'web',
        projectId: 'p1',
        projectName: 'Shop',
        position: 0,
        ...u,
      },
    ]);
  return { svc, sets, shares, environments, link };
}

describe('VariableSetService', () => {
  it('lists only visible sets; members see only the projects they belong to', async () => {
    const { svc } = build();
    expect((await svc.list('root')).map((s) => s.slug)).toEqual([
      'blog',
      'common',
      'shop',
    ]);
    const asDev = await svc.list('dev');
    expect(asDev.map((s) => s.slug)).toEqual(['common', 'shop']);
    const shop = asDev.find((s) => s.slug === 'shop')!;
    expect(shop.projects).toEqual([{ id: 'p1', name: 'Shop' }]);
    expect(shop).toMatchObject({ role: 'developer', canManage: false });
    expect(shop.environments[0]).toMatchObject({
      name: 'production',
      protected: true,
      keyCount: 1,
    });
    expect((await svc.list('view')).map((s) => s.role)).toEqual([
      'viewer',
      'viewer',
    ]);
    expect(await svc.list('outsider')).toEqual([]);
    const asRoot = (await svc.list('root')).find((s) => s.slug === 'shop')!;
    expect(asRoot.projects.map((p) => p.name)).toEqual(['Blog', 'Shop']);
    expect(asRoot.canManage).toBe(true);
  });

  it('detail is 404 for sets not shared with the caller', async () => {
    const { svc } = build();
    await expect(svc.detail('dev', 's2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.detail('dev', 's3')).resolves.toMatchObject({
      slug: 'common',
    });
  });

  it('creates a set with a unique slug and the default environments; only instance admins', async () => {
    const { svc, shares, environments } = build();
    const made = await svc.create('root', {
      name: 'Shop API',
      projectIds: ['p1'],
    });
    expect(made).toMatchObject({ name: 'Shop API', slug: 'shop-api' });
    expect(shares).toContainEqual({ variableSetId: made.id, projectId: 'p1' });
    expect(environments.ensureDefaults).toHaveBeenCalledWith(
      made.id,
      expect.anything(),
    );
    const again = await svc.create('root', { name: 'Shop  ' + 'Extra' });
    expect(again.slug).toBe('shop-extra');
    await expect(svc.create('root', { name: 'shop' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      svc.create('root', { name: 'X', slug: 'shop' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.create('root', { name: 'Y', projectIds: ['nope'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create('dev', { name: 'Mine' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('renames but never changes the slug; project roles cannot manage', async () => {
    const { svc } = build();
    const renamed = await svc.update('root', 's1', {
      name: 'Shop main',
      description: ' d ',
    });
    expect(renamed).toMatchObject({
      name: 'Shop main',
      slug: 'shop',
      description: 'd',
    });
    await expect(
      svc.update('root', 's1', { name: 'common' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.update('dev', 's1', { name: 'Z' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('delete is 409 while linked, naming every application and stack, then deletes', async () => {
    const { svc, sets, link } = build();
    link('e1', {
      kind: 'compose',
      id: 'c9',
      name: 'stack',
      projectId: 'p2',
      projectName: 'Blog',
    });
    const err = await svc.remove('root', 's1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/stack "stack" \(project "Blog"\)/);
    expect(sets.some((s) => s.id === 's1')).toBe(true);
    await svc.remove('root', 's2');
    expect(sets.some((s) => s.id === 's2')).toBe(false);
    await expect(svc.remove('dev', 's3')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sharing cannot take a set away from a project that still links it', async () => {
    const { svc, shares, link } = build();
    link('e1', { projectId: 'p1', projectName: 'Shop' });
    await expect(svc.share('root', 's1', false, ['p2'])).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Shared with all keeps p1's access; dropping p2 (no users there) is fine.
    await svc.share('root', 's1', true, []);
    expect(shares.filter((s) => s.variableSetId === 's1')).toEqual([]);
    await svc.share('root', 's1', false, ['p1']);
    expect(shares.filter((s) => s.variableSetId === 's1')).toEqual([
      { variableSetId: 's1', projectId: 'p1' },
    ]);
  });
});
