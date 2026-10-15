import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  FULL_SCOPE,
  runWithRequestContext,
  type TokenScope,
} from '../auth/request-context';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { ProjectAccessService } from '../project/project-access.service';
import { VariableSetAccessService } from './variable-set-access.service';
import {
  ENV_VERSION_KEEP,
  VariableSetEnvironmentVersion,
} from './variable-set-environment-version.entity';
import { VariableSetEnvironment } from './variable-set-environment.entity';
import { VariableSetEnvironmentService } from './variable-set-environment.service';

const KEY = 'test-encryption-key';

/** Platform roles. `creator` owns project p1 (project admin there). */
const users: Record<string, 'owner' | 'admin' | 'member'> = {
  root: 'owner',
  ops: 'admin',
  creator: 'member',
  dev: 'member',
  view: 'member',
  outsider: 'member',
  other: 'member',
};
const projects = [
  { id: 'p1', ownerId: 'creator' },
  { id: 'p2', ownerId: 'other' },
];
const memberships = [
  { projectId: 'p1', userId: 'dev', role: 'developer' },
  { projectId: 'p1', userId: 'view', role: 'viewer' },
];

/** Set s1 (slug `app`) is shared with p1; set s2 (slug `other`) with p2 only. */
const SETS = [
  { id: 's1', slug: 'app', name: 'App', sharedWithAll: false },
  { id: 's2', slug: 'other', name: 'Other', sharedWithAll: false },
];
const SHARES = [
  { variableSetId: 's1', projectId: 'p1' },
  { variableSetId: 's2', projectId: 'p2' },
];

interface FakeVersion {
  id: string;
  environmentId: string;
  createdAt: Date;
  variablesEncrypted: string | null;
  secretFlags: Record<string, boolean>;
  authorId: string | null;
  authorEmail: string | null;
  via: string;
  action: string;
  detail: string | null;
  summary: {
    added: string[];
    changed: string[];
    removed: string[];
    flags: string[];
  };
}

/** `In([...])` arrives as a FindOperator; plain values compare directly. */
function valueMatches(actual: unknown, expected: unknown): boolean {
  const op = expected as { _type?: string; _value?: unknown[] } | null;
  if (op && typeof op === 'object' && op._type === 'in') {
    return (op._value ?? []).includes(actual);
  }
  return actual === expected;
}

function build(
  initial: Array<Partial<VariableSetEnvironment>> = [],
  opts: { sets?: typeof SETS; shares?: typeof SHARES } = {},
) {
  let n = 0;
  const sets = (opts.sets ?? SETS).map((s) => ({ ...s }));
  const shares = [...(opts.shares ?? SHARES)];
  const rows = [
    {
      id: 'e-dev',
      variableSetId: 's1',
      name: 'development',
      protected: false,
      keys: [],
      secretFlags: {},
      variablesEncrypted: null,
    },
    {
      id: 'e-stg',
      variableSetId: 's1',
      name: 'staging',
      protected: false,
      keys: ['TOKEN'],
      secretFlags: {},
      variablesEncrypted: encryptSecret('TOKEN=stg-token-value', KEY),
    },
    {
      id: 'e-prod',
      variableSetId: 's1',
      name: 'production',
      protected: true,
      keys: ['SECRET'],
      secretFlags: {},
      variablesEncrypted: encryptSecret('SECRET=prod-secret-value', KEY),
    },
    {
      id: 'e-x',
      variableSetId: 's2',
      name: 'development',
      protected: false,
      keys: ['X'],
      secretFlags: {},
      variablesEncrypted: encryptSecret('X=other-project-value', KEY),
    },
    ...initial,
  ].map((r) => ({
    createdAt: new Date(),
    updatedAt: new Date(),
    ...r,
  })) as unknown as VariableSetEnvironment[];
  const usedBy: Array<Record<string, unknown>> = [];
  const matches = (r: object, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      valueMatches((r as Record<string, unknown>)[k], v),
    );
  const repo = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((r) => matches(r, where))),
    findOne: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    count: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((r) => matches(r, where)).length),
    exists: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.some((r) => matches(r, where))),
    create: (v: Partial<VariableSetEnvironment>) => ({
      createdAt: new Date(),
      updatedAt: new Date(),
      variablesEncrypted: null,
      ...v,
    }),
    save: (v: VariableSetEnvironment) => {
      if (!v.id) {
        v.id = `e-new-${++n}`;
        rows.push(v);
      }
      return Promise.resolve(v);
    },
    delete: ({ id }: { id: string }) => {
      rows.splice(
        rows.findIndex((r) => r.id === id),
        1,
      );
      return Promise.resolve();
    },
    query: (_sql: string, [ids]: [string[]]) =>
      Promise.resolve(
        usedBy.filter((u) => ids.includes(u.environment_id as string)),
      ),
    manager: undefined as unknown,
  };
  let clock = 0;
  const versions: FakeVersion[] = [];
  const manager = {
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
    findOne: (entity: unknown, o: { where: Record<string, unknown> }) => {
      if (entity === VariableSetEnvironmentVersion) {
        return Promise.resolve(
          versions.find((v) => matches(v, o.where)) ?? null,
        );
      }
      return Promise.resolve(rows.find((r) => matches(r, o.where)) ?? null);
    },
    save: (v: VariableSetEnvironment) => {
      v.updatedAt = new Date(v.updatedAt.getTime() + 1000);
      return Promise.resolve(v);
    },
    count: (_: unknown, o: { where: Record<string, unknown> }) =>
      Promise.resolve(versions.filter((v) => matches(v, o.where)).length),
    insert: (
      _: unknown,
      row: Omit<FakeVersion, 'id' | 'createdAt'> & { createdAt?: Date },
    ) => {
      versions.push({
        id: `v${++n}`,
        createdAt: new Date(Date.now() + 86_400_000 + ++clock * 1000),
        ...row,
      });
      return Promise.resolve();
    },
    find: (_: unknown, o: { where: Record<string, unknown>; take: number }) =>
      Promise.resolve(
        versions
          .filter((v) => matches(v, o.where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, o.take),
      ),
    query: (_sql: string, [envId, keep]: [string, number]) => {
      const mine = versions
        .filter((v) => v.environmentId === envId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      for (const v of mine.slice(keep)) {
        versions.splice(versions.indexOf(v), 1);
      }
      return Promise.resolve();
    },
  };
  repo.manager = manager;

  const members = {
    manager: {
      findOne: (_: unknown, o: { where: { id: string } }) =>
        Promise.resolve(
          users[o.where.id]
            ? { id: o.where.id, role: users[o.where.id] }
            : null,
        ),
    },
    find: ({ where }: { where: { userId: string } }) =>
      Promise.resolve(memberships.filter((m) => m.userId === where.userId)),
    findOne: (o: { where: { projectId: string; userId: string } }) =>
      Promise.resolve(
        memberships.find(
          (m) =>
            m.projectId === o.where.projectId && m.userId === o.where.userId,
        ) ?? null,
      ),
  };
  const projectRepo = {
    find: ({ where }: { where: { ownerId: string } }) =>
      Promise.resolve(projects.filter((p) => p.ownerId === where.ownerId)),
  };
  const projectAccess = new ProjectAccessService(
    members as never,
    projectRepo as never,
  );
  const setRepo = {
    findOne: ({ where }: { where: { id: string } }) =>
      Promise.resolve(sets.find((s) => s.id === where.id) ?? null),
  };
  const shareRepo = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(shares.filter((s) => matches(s, where))),
  };
  const access = new VariableSetAccessService(
    setRepo as never,
    shareRepo as never,
    projectAccess,
  );
  const svc = new VariableSetEnvironmentService(repo as never, access, {
    getOrThrow: () => KEY,
  } as never);
  return { svc, rows, usedBy, versions, sets, shares, access };
}

/** Runs as a request of the given method, like the middleware does. */
function as<T>(method: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { method, path: '/x', tokenScope: FULL_SCOPE },
    fn,
  );
}

const REVEAL_PATH = '/variable-sets/s1/environments/e-dev/reveal';

/** A request carrying an API token's scope, like JwtAuthGuard sets it. */
function withToken<T>(
  method: string,
  path: string,
  scope: Partial<TokenScope>,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithRequestContext(
    { method, path, tokenScope: { ...FULL_SCOPE, ...scope } },
    fn,
  );
}

describe('VariableSetEnvironmentService access rules', () => {
  const { svc } = build();

  describe('who sees a set', () => {
    it('everyone in a project it is shared with lists versions (no values); outsiders get 404', async () => {
      for (const u of ['view', 'dev', 'creator', 'ops', 'root']) {
        await expect(
          as('GET', () => svc.listVersions(u, 's1', 'e-prod')),
        ).resolves.toEqual([]);
      }
      await expect(
        as('GET', () => svc.listVersions('outsider', 's1', 'e-dev')),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Shared with p2 only: members of p1 do not see it, platform admins do.
      await expect(
        as('GET', () => svc.listVersions('dev', 's2', 'e-x')),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        as('GET', () => svc.listVersions('ops', 's2', 'e-x')),
      ).resolves.toEqual([]);
    });

    it('a set shared with all projects is visible to every project member, not to someone without a project', async () => {
      const { svc: s } = build([], {
        sets: [{ id: 's1', slug: 'app', name: 'App', sharedWithAll: true }],
        shares: [],
      });
      await expect(
        as('GET', () => s.listVersions('view', 's1', 'e-dev')),
      ).resolves.toEqual([]);
      await expect(
        as('GET', () => s.listVersions('outsider', 's1', 'e-dev')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an environment of another set is 404, not readable', async () => {
      await expect(
        as('POST', () => svc.reveal('root', 's1', 'e-x')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reveal and update', () => {
    const actions: Array<
      [string, (u: string, envId: string) => Promise<unknown>, string]
    > = [
      ['reveal', (u, e) => svc.reveal(u, 's1', e), 'POST'],
      ['update', (u, e) => svc.update(u, 's1', e, 'A=1'), 'PUT'],
    ];

    it.each(actions)(
      '%s: viewers get 403 on every environment',
      async (_n, act, method) => {
        for (const env of ['e-dev', 'e-stg', 'e-prod']) {
          await expect(
            as(method, () => act('view', env)),
          ).rejects.toBeInstanceOf(ForbiddenException);
        }
      },
    );

    it.each(actions)(
      '%s: developers and project admins may use unprotected environments only',
      async (_n, act, method) => {
        for (const u of ['dev', 'creator']) {
          await expect(
            as(method, () => act(u, 'e-dev')),
          ).resolves.toBeDefined();
          await expect(
            as(method, () => act(u, 'e-stg')),
          ).resolves.toBeDefined();
          await expect(
            as(method, () => act(u, 'e-prod')),
          ).rejects.toBeInstanceOf(ForbiddenException);
        }
      },
    );

    it.each(actions)(
      '%s: only instance owners/admins may use protected ones',
      async (_n, act, method) => {
        for (const u of ['root', 'ops']) {
          await expect(
            as(method, () => act(u, 'e-prod')),
          ).resolves.toBeDefined();
        }
      },
    );

    it('outsiders get 404', async () => {
      await expect(
        as('POST', () => svc.reveal('outsider', 's1', 'e-dev')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('reveal returns the decrypted text and update stores it encrypted with the key list', async () => {
    const { svc: s, rows } = build();
    const revealed = await as('POST', () => s.reveal('root', 's1', 'e-prod'));
    expect(revealed).toMatchObject({
      variables: 'SECRET=prod-secret-value',
      keys: ['SECRET'],
    });
    expect(revealed.updatedAt).toBeInstanceOf(Date);
    const view = await as('PUT', () =>
      s.update('root', 's1', 'e-prod', 'A=one\n# note\nB=${{vars.A}}-x'),
    );
    expect(view.keys).toEqual(['A', 'B']);
    const stored = rows.find((r) => r.id === 'e-prod')!;
    expect(stored.variablesEncrypted).not.toContain('one');
    expect(decryptSecret(stored.variablesEncrypted!, KEY)).toBe(
      'A=one\n# note\nB=${{vars.A}}-x',
    );
    // An empty text clears the column.
    await as('PUT', () => s.update('root', 's1', 'e-prod', '  \n'));
    expect(stored.variablesEncrypted).toBeNull();
    expect(stored.keys).toEqual([]);
  });

  it('update rejects invalid names, duplicates and bad references with 400; a vars key of another set is fine', async () => {
    for (const bad of [
      '1BAD=x',
      'NOEQUALS',
      'A=1\nA=2',
      'A=${{project.NOPE}}',
      'A=${{vars.}}',
    ]) {
      await expect(
        as('PUT', () => svc.update('dev', 's1', 'e-dev', bad)),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      as('PUT', () =>
        svc.update('dev', 's1', 'e-dev', 'A=${{vars.ELSEWHERE}}'),
      ),
    ).resolves.toBeDefined();
  });

  describe('create and delete environments (instance owners/admins)', () => {
    it('platform admins create (optionally protected); project roles cannot', async () => {
      const { svc: s } = build();
      const created = await as('POST', () => s.create('ops', 's1', 'qa'));
      expect(created).toMatchObject({ name: 'qa', protected: false, keys: [] });
      const locked = await as('POST', () =>
        s.create('root', 's1', 'prod-eu', true),
      );
      expect(locked.protected).toBe(true);
      for (const u of ['creator', 'dev', 'view']) {
        await expect(
          as('POST', () => s.create(u, 's1', 'qa2')),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      await expect(
        as('POST', () => s.create('ops', 's1', 'qa')),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('a linked environment is 409 naming every user; an unlinked one (protected too) is deleted', async () => {
      const {
        svc: s,
        usedBy,
        rows,
      } = build([
        { id: 'e-qa', variableSetId: 's1', name: 'qa', protected: false },
      ]);
      await expect(
        as('DELETE', () => s.remove('creator', 's1', 'e-qa')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      usedBy.push({
        environment_id: 'e-qa',
        position: 0,
        kind: 'application',
        id: 'a1',
        name: 'web',
        project_id: 'p2',
        project_name: 'Elsewhere',
      });
      const err = await as('DELETE', () =>
        s.remove('root', 's1', 'e-qa'),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(
        /application "web" \(project "Elsewhere"\)/,
      );
      expect(rows.some((r) => r.id === 'e-qa')).toBe(true);

      usedBy.length = 0;
      await as('DELETE', () => s.remove('root', 's1', 'e-qa'));
      expect(rows.some((r) => r.id === 'e-qa')).toBe(false);
      await as('DELETE', () => s.remove('root', 's1', 'e-prod'));
      expect(rows.some((r) => r.id === 'e-prod')).toBe(false);
    });

    it('usage lists only projects the caller may see', async () => {
      const { svc: s, usedBy, access } = build();
      usedBy.push(
        {
          environment_id: 'e-dev',
          position: 1,
          kind: 'compose',
          id: 'c1',
          name: 'stack',
          project_id: 'p1',
          project_name: 'Mine',
        },
        {
          environment_id: 'e-dev',
          position: 0,
          kind: 'application',
          id: 'a2',
          name: 'hidden',
          project_id: 'p2',
          project_name: 'Theirs',
        },
      );
      const env = (await s.listOf('s1')).find((e) => e.id === 'e-dev')!;
      const asDev = await as('GET', async () =>
        s.views([env], await access.context('dev')),
      );
      expect(asDev[0].usedBy.map((u) => u.name)).toEqual(['stack']);
      expect(asDev[0].usedBy[0]).toMatchObject({
        kind: 'compose',
        position: 1,
      });
      const asRoot = await as('GET', async () =>
        s.views([env], await access.context('root')),
      );
      expect(asRoot[0].usedBy).toHaveLength(2);
    });
  });

  describe('layersFor (resolver and deploys)', () => {
    it('decrypts the given environments in order, with flags, without any actor', async () => {
      const { svc: s, rows } = build();
      rows.find((r) => r.id === 'e-stg')!.secretFlags = { TOKEN: true };
      expect(await s.layersFor(['e-stg', 'e-dev', 'e-missing'])).toEqual([
        {
          environmentId: 'e-stg',
          text: 'TOKEN=stg-token-value',
          flags: { TOKEN: true },
        },
        { environmentId: 'e-dev', text: '', flags: {} },
      ]);
      expect(await s.layersFor([])).toEqual([]);
    });
  });

  describe('reveal route (read-only POST) keeps denying viewers', () => {
    it('a viewer is refused by the service even though the route is not a write', async () => {
      const { svc: s } = build();
      for (const env of ['e-dev', 'e-stg', 'e-prod']) {
        await expect(
          runWithRequestContext(
            { method: 'POST', path: REVEAL_PATH, tokenScope: FULL_SCOPE },
            () => s.reveal('view', 's1', env),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('a viewer with a read-only token is refused too', async () => {
      const { svc: s } = build();
      await expect(
        withToken('POST', REVEAL_PATH, { readOnly: true }, () =>
          s.reveal('view', 's1', 'e-dev'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a developer still reveals an unprotected environment on that route', async () => {
      const { svc: s } = build();
      await expect(
        withToken('POST', REVEAL_PATH, { readOnly: true }, () =>
          s.reveal('dev', 's1', 'e-dev'),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('API token variable scope', () => {
    it('set/env: reveals and updates only that environment', async () => {
      const { svc: s } = build();
      const scope = { variableScopes: ['app/development'] };
      await expect(
        withToken('POST', REVEAL_PATH, scope, () =>
          s.reveal('root', 's1', 'e-dev'),
        ),
      ).resolves.toBeDefined();
      await expect(
        withToken('PUT', '/x', scope, () =>
          s.update('root', 's1', 'e-dev', 'A=1'),
        ),
      ).resolves.toBeDefined();
      for (const env of ['e-stg', 'e-prod']) {
        await expect(
          withToken('POST', REVEAL_PATH, scope, () =>
            s.reveal('root', 's1', env),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          withToken('PUT', '/x', scope, () =>
            s.update('root', 's1', env, 'A=1'),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('set/* covers every environment of that set; */env that name in any set', async () => {
      const { svc: s } = build();
      for (const env of ['e-dev', 'e-stg', 'e-prod']) {
        await expect(
          withToken('POST', REVEAL_PATH, { variableScopes: ['app/*'] }, () =>
            s.reveal('root', 's1', env),
          ),
        ).resolves.toBeDefined();
      }
      await expect(
        withToken('POST', REVEAL_PATH, { variableScopes: ['other/*'] }, () =>
          s.reveal('root', 's1', 'e-dev'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        withToken('POST', REVEAL_PATH, { variableScopes: ['*/staging'] }, () =>
          s.reveal('root', 's1', 'e-stg'),
        ),
      ).resolves.toBeDefined();
      await expect(
        withToken('POST', REVEAL_PATH, { variableScopes: ['*/staging'] }, () =>
          s.reveal('root', 's1', 'e-dev'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not widen: a developer token scoped to production still cannot reach it', async () => {
      const { svc: s } = build();
      await expect(
        withToken(
          'POST',
          REVEAL_PATH,
          { variableScopes: ['app/production'] },
          () => s.reveal('dev', 's1', 'e-prod'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a token limited to other projects does not see the set at all', async () => {
      const { svc: s } = build();
      await expect(
        withToken('POST', REVEAL_PATH, { projectIds: ['p2'] }, () =>
          s.reveal('dev', 's1', 'e-dev'),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      // A platform admin's project-scoped token only sees sets shared with those projects.
      await expect(
        withToken('POST', REVEAL_PATH, { projectIds: ['p2'] }, () =>
          s.reveal('ops', 's1', 'e-dev'),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        withToken('POST', REVEAL_PATH, { projectIds: ['p1'] }, () =>
          s.reveal('ops', 's1', 'e-prod'),
        ),
      ).resolves.toBeDefined();
    });

    it('cannot create or delete environments outside the scope', async () => {
      const { svc: s } = build();
      const scope = { variableScopes: ['app/development'] };
      await expect(
        withToken('POST', '/x', scope, () => s.create('root', 's1', 'qa')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        withToken('DELETE', '/x', scope, () => s.remove('root', 's1', 'e-stg')),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('optimistic concurrency on update', () => {
    it('saves when expectedUpdatedAt matches and answers 409 when it does not', async () => {
      const { svc: s } = build();
      const read = await as('POST', () => s.reveal('dev', 's1', 'e-dev'));
      const stale = read.updatedAt.toISOString();
      const first = await as('PUT', () =>
        s.update('dev', 's1', 'e-dev', 'A=1', stale),
      );
      expect(first.keys).toEqual(['A']);
      // The same stale version again: someone else saved in between.
      await expect(
        as('PUT', () => s.update('dev', 's1', 'e-dev', 'A=2', stale)),
      ).rejects.toBeInstanceOf(ConflictException);
      // Without the field the last write wins (older clients).
      await expect(
        as('PUT', () => s.update('dev', 's1', 'e-dev', 'A=3')),
      ).resolves.toBeDefined();
    });

    it('rejects an unparsable expectedUpdatedAt', async () => {
      await expect(
        as('PUT', () => svc.update('dev', 's1', 'e-dev', 'A=1', 'nope')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('export', () => {
    it('exports values only when asked', async () => {
      const { svc: s } = build();
      const plain = await s.exportOf('s1', false);
      expect(plain).toEqual([
        {
          name: 'development',
          protected: false,
          secretKeys: [],
          plainKeys: [],
        },
        { name: 'staging', protected: false, secretKeys: [], plainKeys: [] },
        { name: 'production', protected: true, secretKeys: [], plainKeys: [] },
      ]);
      expect(JSON.stringify(plain)).not.toMatch(/variables/);
      const full = await s.exportOf('s1', true);
      expect(full.find((e) => e.name === 'production')?.variables).toBe(
        'SECRET=prod-secret-value',
      );
    });
  });
});

describe('VariableSetEnvironmentService history, restore, diff, promote and secret flags', () => {
  const dev = {
    userId: 'dev',
    email: 'dev@example.com',
    via: 'session' as const,
  };
  const ci = { userId: 'dev', email: 'dev@example.com', via: 'token' as const };
  const admin = {
    userId: 'root',
    email: 'admin@example.com',
    via: 'session' as const,
  };

  it('stores a version per real change with a key-level summary and a baseline of the old content', async () => {
    const { svc, versions } = build();
    await as('PUT', () =>
      svc.update(admin, 's1', 'e-prod', 'SECRET=prod-secret-value\nNEW=1'),
    );
    // Baseline (content before the first recorded change) + the change.
    expect(versions.map((v) => v.action)).toEqual(['baseline', 'edit']);
    expect(versions[1]).toMatchObject({
      authorEmail: 'admin@example.com',
      authorId: 'root',
      via: 'session',
      summary: { added: ['NEW'], changed: [], removed: [], flags: [] },
    });
    // Texts are encrypted, summaries hold no values.
    expect(versions[1].variablesEncrypted).not.toContain('NEW=1');
    expect(JSON.stringify(versions.map((v) => v.summary))).not.toMatch(
      /prod-secret-value/,
    );
    await as('PUT', () =>
      svc.update(ci, 's1', 'e-dev', 'A=1', undefined, { action: 'set' }),
    );
    await as('PUT', () => svc.update(ci, 's1', 'e-dev', 'A=2\nB=1'));
    await as('PUT', () => svc.update(ci, 's1', 'e-dev', 'B=1'));
    const mine = versions.filter((v) => v.environmentId === 'e-dev');
    expect(
      mine.map((v) => [
        v.action,
        v.via,
        v.summary.added,
        v.summary.changed,
        v.summary.removed,
      ]),
    ).toEqual([
      ['set', 'token', ['A'], [], []],
      ['edit', 'token', ['B'], ['A'], []],
      ['edit', 'token', [], [], ['A']],
    ]);
  });

  it('does not store a version when nothing changed', async () => {
    const { svc, versions } = build();
    await as('PUT', () =>
      svc.update(dev, 's1', 'e-stg', 'TOKEN=stg-token-value\r\n'),
    );
    expect(versions).toHaveLength(0);
  });

  it('lists versions to every member without any value', async () => {
    const { svc } = build();
    await as('PUT', () =>
      svc.update(admin, 's1', 'e-prod', 'SECRET=changed-1234'),
    );
    for (const u of ['view', 'dev', 'creator']) {
      const list = await as('GET', () => svc.listVersions(u, 's1', 'e-prod'));
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({ current: true, action: 'edit' });
      expect(list[1]).toMatchObject({ current: false, action: 'baseline' });
      expect(JSON.stringify(list)).not.toMatch(
        /prod-secret-value|changed-1234/,
      );
    }
    await expect(
      as('GET', () => svc.listVersions('outsider', 's1', 'e-prod')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reveals a version with the reveal rules (viewer and protected refused)', async () => {
    const { svc, versions } = build();
    await as('PUT', () =>
      svc.update(admin, 's1', 'e-prod', 'SECRET=changed-1234'),
    );
    const base = versions.find((v) => v.action === 'baseline')!;
    const shown = await as('POST', () =>
      svc.revealVersion('root', 's1', 'e-prod', base.id),
    );
    expect(shown.variables).toBe('SECRET=prod-secret-value');
    for (const u of ['view', 'dev']) {
      await expect(
        as('POST', () => svc.revealVersion(u, 's1', 'e-prod', base.id)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('restore writes the old text as a new version, brings the flags back and never rewrites history', async () => {
    const { svc, versions, rows } = build();
    await as('PUT', () =>
      svc.update(dev, 's1', 'e-dev', 'PIN=ab1\nHOST=a', undefined, {
        flags: { PIN: true },
      }),
    );
    await as('PUT', () =>
      svc.update(dev, 's1', 'e-dev', 'HOST=b', undefined, {}),
    );
    const first = versions.find((v) => v.action === 'edit')!;
    const countBefore = versions.length;
    const view = await as('POST', () =>
      svc.restoreVersion(dev, 's1', 'e-dev', first.id),
    );
    expect(view.keys).toEqual(['PIN', 'HOST']);
    expect(view.secretKeys).toEqual(['PIN']);
    expect(versions).toHaveLength(countBefore + 1);
    expect(versions.at(-1)).toMatchObject({
      action: 'restore',
      summary: { added: ['PIN'], changed: ['HOST'], removed: [] },
    });
    const dec = decryptSecret(
      rows.find((r) => r.id === 'e-dev')!.variablesEncrypted!,
      KEY,
    );
    expect(dec).toBe('PIN=ab1\nHOST=a');
    // Restoring what is already current is refused.
    await expect(
      as('POST', () =>
        svc.restoreVersion(dev, 's1', 'e-dev', versions.at(-1)!.id),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restore follows the edit rules and honours expectedUpdatedAt', async () => {
    const { svc, versions, rows } = build();
    await as('PUT', () =>
      svc.update(admin, 's1', 'e-prod', 'SECRET=changed-1234'),
    );
    const base = versions.find((v) => v.action === 'baseline')!;
    await expect(
      as('POST', () => svc.restoreVersion(dev, 's1', 'e-prod', base.id)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      as('POST', () => svc.restoreVersion('view', 's1', 'e-prod', base.id)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const stale = new Date(
      rows.find((r) => r.id === 'e-prod')!.updatedAt.getTime() - 5000,
    ).toISOString();
    await expect(
      as('POST', () =>
        svc.restoreVersion(admin, 's1', 'e-prod', base.id, stale),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const fresh = rows.find((r) => r.id === 'e-prod')!.updatedAt.toISOString();
    await expect(
      as('POST', () =>
        svc.restoreVersion(admin, 's1', 'e-prod', base.id, fresh),
      ),
    ).resolves.toBeDefined();
    // A version of another environment is a 404.
    await expect(
      as('POST', () => svc.restoreVersion(dev, 's1', 'e-dev', base.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps only the newest versions of an environment', async () => {
    const { svc, versions } = build();
    for (let i = 1; i <= ENV_VERSION_KEEP + 7; i++) {
      await as('PUT', () => svc.update(dev, 's1', 'e-dev', `N=${i}`));
    }
    const mine = versions.filter((v) => v.environmentId === 'e-dev');
    expect(mine).toHaveLength(ENV_VERSION_KEEP);
    const list = await as('GET', () => svc.listVersions('dev', 's1', 'e-dev'));
    expect(list[0].summary.changed).toEqual(['N']);
    // The oldest ones are gone; another environment is untouched.
    expect(versions.filter((v) => v.environmentId === 'e-stg')).toHaveLength(0);
  });

  describe('secret flags', () => {
    it('flags a new key with a secret-looking name, keeps explicit choices and drops removed keys', async () => {
      const { svc, rows } = build();
      const v1 = await as('PUT', () =>
        svc.update(
          dev,
          's1',
          'e-dev',
          'API_KEY=abc\nHOST=a\nDB_PASSWORD=x',
          undefined,
          {
            flags: { DB_PASSWORD: false },
          },
        ),
      );
      expect(v1.secretKeys).toEqual(['API_KEY']);
      expect(v1.plainKeys).toEqual(['DB_PASSWORD']);
      // Another write keeps flags; a key that existed unmarked is not auto-flagged later.
      const v2 = await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', 'API_KEY=abc\nHOST=b\nDB_PASSWORD=x'),
      );
      expect(v2.secretKeys).toEqual(['API_KEY']);
      const v3 = await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', 'HOST=b', undefined, {}),
      );
      expect(v3.secretKeys).toEqual([]);
      expect(rows.find((r) => r.id === 'e-dev')!.secretFlags).toEqual({});
      // null clears a flag.
      const v4 = await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', 'TOKEN=t', undefined, {
          flags: { TOKEN: null },
        }),
      );
      expect(v4.secretKeys).toEqual([]);
    });

    it('rejects a flag for a variable that is not in the text', async () => {
      const { svc } = build();
      await expect(
        as('PUT', () =>
          svc.update(dev, 's1', 'e-dev', 'A=1', undefined, {
            flags: { B: true },
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lists secret keys to every member and reveals the flags with the values', async () => {
      const { svc, access } = build();
      await as('PUT', () => svc.update(dev, 's1', 'e-dev', 'A_TOKEN=1'));
      const list = await as('GET', async () =>
        svc.views(await svc.listOf('s1'), await access.context('view')),
      );
      expect(list.find((e) => e.name === 'development')!.secretKeys).toEqual([
        'A_TOKEN',
      ]);
      const shown = await as('POST', () => svc.reveal(dev, 's1', 'e-dev'));
      expect(shown.secretKeys).toEqual(['A_TOKEN']);
    });

    it('layersFor hands the resolver the flags', async () => {
      const { svc } = build();
      await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', 'A=1', undefined, {
          flags: { A: true },
        }),
      );
      expect(await svc.layersFor(['e-dev'])).toEqual([
        { environmentId: 'e-dev', text: 'A=1', flags: { A: true } },
      ]);
    });
  });

  describe('diff', () => {
    it('compares values server-side for someone who may reveal both sides, never returning values', async () => {
      const { svc } = build();
      await as('PUT', () =>
        svc.update(
          admin,
          's1',
          'e-prod',
          'SECRET=prod-secret-value\nSAME=1\nDIFF=prod',
        ),
      );
      await as('PUT', () =>
        svc.update(admin, 's1', 'e-stg', 'SAME=1\nDIFF=stg\nONLY_STG=x'),
      );
      const d = await as('GET', () =>
        svc.diff('root', 's1', 'staging', 'production'),
      );
      expect(d).toMatchObject({
        comparable: true,
        onlyInFrom: ['ONLY_STG'],
        onlyInTo: ['SECRET'],
        different: ['DIFF'],
        same: ['SAME'],
      });
      expect(JSON.stringify(d)).not.toMatch(
        /prod-secret-value|=stg|prod\b.*value/,
      );
    });

    it('gives a developer names only when production is one side (different is unknown)', async () => {
      const { svc } = build();
      const d = await as('GET', () =>
        svc.diff('dev', 's1', 'staging', 'production'),
      );
      expect(d.comparable).toBe(false);
      expect(d.different).toBeNull();
      expect(d.same).toBeNull();
      expect(d.onlyInFrom).toEqual(['TOKEN']);
      expect(d.onlyInTo).toEqual(['SECRET']);
      // Two unprotected environments compare fully; viewers never see values compared.
      expect(
        (await as('GET', () => svc.diff('dev', 's1', 'development', 'staging')))
          .comparable,
      ).toBe(true);
      expect(
        (
          await as('GET', () =>
            svc.diff('view', 's1', 'development', 'staging'),
          )
        ).comparable,
      ).toBe(false);
    });

    it('treats a token limited to other environments as unable to reveal', async () => {
      const { svc } = build();
      const d = await withToken(
        'GET',
        '/x',
        { variableScopes: ['app/development'] },
        () => svc.diff('dev', 's1', 'development', 'staging'),
      );
      expect(d.comparable).toBe(false);
    });

    it('answers 404 for an unknown name', async () => {
      const { svc } = build();
      await expect(
        as('GET', () => svc.diff('dev', 's1', 'nope', 'staging')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('notes', () => {
    const noted = '# Section\n\n# Base URL\n# with /v1\nAPI=http://x/v1\nB=2';

    it('recomputes notes on every write, shows them to viewers and snapshots them per version', async () => {
      const { svc, rows, versions } = build();
      const saved = await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', noted),
      );
      expect(saved.notes).toEqual({ API: 'Base URL\nwith /v1' });
      expect(rows.find((r) => r.id === 'e-dev')!.notes).toEqual({
        API: 'Base URL\nwith /v1',
      });
      expect((versions.at(-1) as unknown as { notes: object }).notes).toEqual({
        API: 'Base URL\nwith /v1',
      });
      // A viewer never reveals values but reads names, flags and notes.
      const view = svc.view(
        rows.find((r) => r.id === 'e-dev')!,
        [],
      );
      expect(view.notes).toEqual({ API: 'Base URL\nwith /v1' });
      const revealed = await as('POST', () => svc.reveal(dev, 's1', 'e-dev'));
      expect(revealed.notes).toEqual({ API: 'Base URL\nwith /v1' });
      // Removing the comment removes the note.
      const after = await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', 'API=http://x/v1\nB=2'),
      );
      expect(after.notes).toEqual({});
      const list = await as('GET', () =>
        svc.listVersions('view', 's1', 'e-dev'),
      );
      expect(list.map((v) => v.notes)).toEqual([
        {},
        { API: 'Base URL\nwith /v1' },
      ]);
    });

    it('a note-only change is a change; an identical save is not', async () => {
      const { svc, versions } = build();
      await as('PUT', () => svc.update(dev, 's1', 'e-dev', noted));
      const count = versions.length;
      await as('PUT', () => svc.update(dev, 's1', 'e-dev', noted + '\n'));
      expect(versions).toHaveLength(count);
      await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', noted.replace('Base URL', 'Root URL')),
      );
      expect(versions).toHaveLength(count + 1);
    });

    it('restore brings the notes of the old text back', async () => {
      const { svc, versions } = build();
      await as('PUT', () => svc.update(dev, 's1', 'e-dev', noted));
      await as('PUT', () => svc.update(dev, 's1', 'e-dev', 'API=other'));
      const first = versions.find(
        (v) => v.environmentId === 'e-dev' && v.action === 'edit',
      )!;
      const view = await as('POST', () =>
        svc.restoreVersion(dev, 's1', 'e-dev', first.id),
      );
      expect(view.notes).toEqual({ API: 'Base URL\nwith /v1' });
      const shown = await as('POST', () =>
        svc.revealVersion(dev, 's1', 'e-dev', first.id),
      );
      expect(shown.notes).toEqual({ API: 'Base URL\nwith /v1' });
    });

    it('promote brings the note of a new key; an existing key keeps its own note', async () => {
      const { svc, rows } = build();
      await as('PUT', () =>
        svc.update(dev, 's1', 'e-stg', '# from staging\nA=new\n# new one\nN=1'),
      );
      await as('PUT', () =>
        svc.update(dev, 's1', 'e-dev', '# dev note\nA=old\n# trailing'),
      );
      const out = await as('POST', () =>
        svc.promote(dev, 's1', 'e-dev', 'e-stg', ['A', 'N']),
      );
      expect(
        decryptSecret(
          rows.find((r) => r.id === 'e-dev')!.variablesEncrypted!,
          KEY,
        ),
      ).toBe('# dev note\nA=new\n# trailing\n\n# new one\nN=1');
      expect(out.environment.notes).toEqual({ A: 'dev note', N: 'new one' });
    });
  });

  describe('promote', () => {
    it('copies chosen keys: keeps the target comments and order, appends new keys, brings the flag, stores a version', async () => {
      const { svc, rows, versions } = build();
      await as('PUT', () =>
        svc.update(
          admin,
          's1',
          'e-stg',
          'A=new\nNEW_TOKEN=s3\nOTHER=o',
          undefined,
          {
            flags: { A: false },
          },
        ),
      );
      await as('PUT', () =>
        svc.update(admin, 's1', 'e-prod', '# prod config\nA=old\n\nKEEP=1'),
      );
      const out = await as('POST', () =>
        svc.promote(admin, 's1', 'e-prod', 'e-stg', ['A', 'NEW_TOKEN']),
      );
      expect(out.summary).toMatchObject({
        added: ['NEW_TOKEN'],
        changed: ['A'],
        removed: [],
      });
      expect(
        decryptSecret(
          rows.find((r) => r.id === 'e-prod')!.variablesEncrypted!,
          KEY,
        ),
      ).toBe('# prod config\nA=new\n\nKEEP=1\nNEW_TOKEN=s3');
      expect(out.environment.secretKeys).toEqual(['NEW_TOKEN']);
      expect(out.environment.plainKeys).toEqual(['A']);
      expect(versions.at(-1)).toMatchObject({
        action: 'promote',
        detail: 'From staging',
      });
    });

    it('needs reveal on the source and edit on the target: developers cannot touch production on either side', async () => {
      const { svc } = build();
      await expect(
        as('POST', () => svc.promote(dev, 's1', 'e-prod', 'e-stg', ['TOKEN'])),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('POST', () => svc.promote(dev, 's1', 'e-stg', 'e-prod', ['SECRET'])),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('POST', () =>
          svc.promote('view', 's1', 'e-dev', 'e-stg', ['TOKEN']),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('POST', () => svc.promote(dev, 's1', 'e-dev', 'e-stg', ['TOKEN'])),
      ).resolves.toBeDefined();
    });

    it('refuses a missing key, an empty list, the same environment and a stale version', async () => {
      const { svc, rows } = build();
      await expect(
        as('POST', () => svc.promote(dev, 's1', 'e-dev', 'e-stg', ['NOPE'])),
      ).rejects.toThrow(/Not set in "staging": NOPE/);
      await expect(
        as('POST', () => svc.promote(dev, 's1', 'e-dev', 'e-stg', [])),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        as('POST', () => svc.promote(dev, 's1', 'e-dev', 'e-dev', ['A'])),
      ).rejects.toBeInstanceOf(BadRequestException);
      const stale = new Date(
        rows.find((r) => r.id === 'e-dev')!.updatedAt.getTime() - 1000,
      ).toISOString();
      await expect(
        as('POST', () =>
          svc.promote(dev, 's1', 'e-dev', 'e-stg', ['TOKEN'], stale),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('promotes a vars reference whose key lives elsewhere (checked against links, not here)', async () => {
      const { svc, rows } = build();
      await as('PUT', () =>
        svc.update(dev, 's1', 'e-stg', 'BASE=1\nURL=${{vars.BASE}}/x'),
      );
      await as('POST', () => svc.promote(dev, 's1', 'e-dev', 'e-stg', ['URL']));
      const target = rows.find((r) => r.id === 'e-dev')!;
      expect(decryptSecret(target.variablesEncrypted!, KEY)).toBe(
        'URL=${{vars.BASE}}/x',
      );
    });
  });
});
