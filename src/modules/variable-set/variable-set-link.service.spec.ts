import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ProjectRole } from '../project/project-member.entity';
import { Project } from '../project/project.entity';
import { VariableSetEnvironment } from './variable-set-environment.entity';
import { VariableSetLink } from './variable-set-link.entity';
import {
  linkConflicts,
  VariableSetLinkService,
} from './variable-set-link.service';
import { VariableSetProject } from './variable-set-project.entity';
import { VariableSet } from './variable-set.entity';

function valueIn(actual: unknown, expected: unknown): boolean {
  const op = expected as { _type?: string; _value?: unknown[] } | null;
  if (op && typeof op === 'object' && op._type === 'in') {
    return (op._value ?? []).includes(actual);
  }
  return actual === expected;
}

function build(
  projectRoles: Record<string, ProjectRole> = {},
  current: string[] = [],
) {
  const envs = [
    {
      id: 'e-dev',
      variableSetId: 's1',
      name: 'development',
      protected: false,
      keys: ['A', 'B'],
    },
    {
      id: 'e-prod',
      variableSetId: 's1',
      name: 'production',
      protected: true,
      keys: ['A'],
    },
    {
      id: 'e-common',
      variableSetId: 's2',
      name: 'production',
      protected: false,
      keys: ['B', 'C'],
    },
    {
      id: 'e-alien',
      variableSetId: 's3',
      name: 'development',
      protected: false,
      keys: [],
    },
  ];
  const sets = [
    { id: 's1', name: 'App', slug: 'app', sharedWithAll: false },
    { id: 's2', name: 'Common', slug: 'common', sharedWithAll: true },
    { id: 's3', name: 'Alien', slug: 'alien', sharedWithAll: false },
  ];
  const shares = [
    { variableSetId: 's1', projectId: 'p1' },
    { variableSetId: 's3', projectId: 'p2' },
  ];
  const links = current.map((environmentId, position) => ({
    id: `l${position}`,
    environmentId,
    position,
    applicationId: 'a1',
    composeAppId: null,
  }));
  const matches = (r: object, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      valueIn((r as Record<string, unknown>)[k], v),
    );
  const table = (entity: unknown): object[] =>
    entity === VariableSetEnvironment
      ? envs
      : entity === VariableSet
        ? sets
        : entity === VariableSetProject
          ? shares
          : entity === VariableSetLink
            ? links
            : [];
  const inserted: unknown[] = [];
  const manager = {
    find: (entity: unknown, o: { where: Record<string, unknown> }) =>
      Promise.resolve(table(entity).filter((r) => matches(r, o.where))),
    findOne: (entity: unknown) =>
      Promise.resolve(entity === Project ? { id: 'p1', ownerId: 'x' } : null),
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
    delete: () => Promise.resolve(),
    insert: (_: unknown, rows: unknown) => {
      inserted.push(rows);
      return Promise.resolve();
    },
  };
  const repo = {
    find: (o: { where: Record<string, unknown> }) =>
      Promise.resolve(links.filter((l) => matches(l, o.where))),
    manager,
  };
  const access = {
    roleFor: (userId: string) => Promise.resolve(projectRoles[userId] ?? null),
  };
  const svc = new VariableSetLinkService(repo as never, access as never);
  const owner = { kind: 'application' as const, id: 'a1', projectId: 'p1' };
  return { svc, owner, inserted };
}

describe('linkConflicts', () => {
  it('reports keys shadowed by a later link and keys the own env overrides', () => {
    expect(
      linkConflicts(
        [{ keys: ['A', 'B', 'C'] }, { keys: ['B'] }, { keys: ['C', 'D'] }],
        ['C', 'D', 'A'],
      ),
    ).toEqual([
      { shadowedKeys: ['B', 'C'], overriddenByOwnEnv: ['A'] },
      { shadowedKeys: [], overriddenByOwnEnv: [] },
      { shadowedKeys: [], overriddenByOwnEnv: ['C', 'D'] },
    ]);
  });
});

describe('VariableSetLinkService', () => {
  it('views carry set names, protection, keys and conflicts in order', async () => {
    const { svc, owner } = build({}, ['e-dev', 'e-common']);
    const views = await svc.views(owner, 'C=own');
    expect(views).toEqual([
      expect.objectContaining({
        position: 0,
        environmentId: 'e-dev',
        environmentName: 'development',
        setName: 'App',
        setSlug: 'app',
        protected: false,
        shadowedKeys: ['B'],
        overriddenByOwnEnv: [],
      }),
      expect.objectContaining({
        position: 1,
        setName: 'Common',
        shadowedKeys: [],
        overriddenByOwnEnv: ['C'],
      }),
    ]);
  });

  it('accepts environments of sets shared with the project or with all projects', async () => {
    const { svc, owner } = build({ dev: 'developer' });
    await expect(
      svc.validate(owner, ['e-dev', 'e-common'], 'dev'),
    ).resolves.toBeUndefined();
  });

  it('refuses a set not shared with the project, an unknown id, duplicates and too many', async () => {
    const { svc, owner } = build({ dev: 'developer' });
    for (const ids of [
      ['e-alien'],
      ['nope'],
      ['e-dev', 'e-dev'],
      Array.from({ length: 11 }, (_, i) => `x${i}`),
    ]) {
      await expect(svc.validate(owner, ids, 'dev')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('linking to a protected environment needs the project admin', async () => {
    const { svc, owner } = build({ dev: 'developer', boss: 'admin' });
    await expect(svc.validate(owner, ['e-prod'], 'dev')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      svc.validate(owner, ['e-prod'], 'boss'),
    ).resolves.toBeUndefined();
    // No actor (import, background): no role rule.
    await expect(
      svc.validate(owner, ['e-prod'], null),
    ).resolves.toBeUndefined();
  });

  it('unlinking a protected environment needs the project admin; keeping or reordering it does not', async () => {
    const { svc, owner } = build({ dev: 'developer', boss: 'admin' }, [
      'e-prod',
      'e-dev',
    ]);
    await expect(svc.validate(owner, ['e-dev'], 'dev')).rejects.toThrow(
      /unlink the protected "production"/,
    );
    await expect(
      svc.validate(owner, ['e-dev', 'e-prod', 'e-common'], 'dev'),
    ).resolves.toBeUndefined();
    await expect(svc.validate(owner, [], 'boss')).resolves.toBeUndefined();
  });

  it('replace writes the order as positions', async () => {
    const { svc, inserted } = build();
    await svc.replace('compose', 'c1', ['e-common', 'e-dev']);
    expect(inserted).toEqual([
      [
        {
          environmentId: 'e-common',
          position: 0,
          applicationId: null,
          composeAppId: 'c1',
        },
        {
          environmentId: 'e-dev',
          position: 1,
          applicationId: null,
          composeAppId: 'c1',
        },
      ],
    ]);
  });
});
