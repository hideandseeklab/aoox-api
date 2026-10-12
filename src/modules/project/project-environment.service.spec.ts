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
import { ProjectAccessService } from './project-access.service';
import {
  ENV_VERSION_KEEP,
  ProjectEnvironmentVersion,
} from './environment-version.entity';
import { ProjectEnvironment } from './project-environment.entity';
import { ProjectEnvironmentService } from './project-environment.service';
import type { Project } from './project.entity';
import { ProjectService } from './project.service';

const KEY = 'test-encryption-key';
const project = { id: 'p1', ownerId: 'creator' } as Project;

const users: Record<string, 'owner' | 'admin' | 'member'> = {
  root: 'owner',
  ops: 'admin',
  creator: 'member',
  dev: 'member',
  view: 'member',
  outsider: 'member',
};
const memberships = [
  { projectId: 'p1', userId: 'dev', role: 'developer' },
  { projectId: 'p1', userId: 'view', role: 'viewer' },
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

function build(initial: Array<Partial<ProjectEnvironment>> = []) {
  let n = 0;
  const rows = [
    {
      id: 'e-dev',
      projectId: 'p1',
      name: 'development',
      protected: false,
      keys: [],
      variablesEncrypted: null,
    },
    {
      id: 'e-stg',
      projectId: 'p1',
      name: 'staging',
      protected: false,
      keys: ['TOKEN'],
      variablesEncrypted: encryptSecret('TOKEN=stg-token-value', KEY),
    },
    {
      id: 'e-prod',
      projectId: 'p1',
      name: 'production',
      protected: true,
      keys: ['SECRET'],
      variablesEncrypted: encryptSecret('SECRET=prod-secret-value', KEY),
    },
    ...initial,
  ].map((r) => ({
    createdAt: new Date(),
    updatedAt: new Date(),
    ...r,
  })) as unknown as ProjectEnvironment[];
  const usedBy: Array<Record<string, string>> = [];
  const matches = (r: ProjectEnvironment, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
    );
  const repo = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((r) => matches(r, where))),
    findOne: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    findOneOrFail: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((r) => matches(r, where))),
    count: () => Promise.resolve(rows.length),
    exists: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.some((r) => matches(r, where))),
    create: (v: Partial<ProjectEnvironment>) => ({
      createdAt: new Date(),
      updatedAt: new Date(),
      variablesEncrypted: null,
      ...v,
    }),
    save: (v: ProjectEnvironment) => {
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
    query: () => Promise.resolve(usedBy),
    manager: undefined as unknown,
  };
  let clock = 0;
  const versions: FakeVersion[] = [];
  const manager = {
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
    findOne: (entity: unknown, o: { where: Record<string, unknown> }) => {
      if (entity === ProjectEnvironmentVersion) {
        return Promise.resolve(
          versions.find((v) => matches(v as never, o.where)) ?? null,
        );
      }
      return Promise.resolve(rows.find((r) => matches(r, o.where)) ?? null);
    },
    save: (v: ProjectEnvironment) => {
      v.updatedAt = new Date(v.updatedAt.getTime() + 1000);
      return Promise.resolve(v);
    },
    count: (_: unknown, o: { where: Record<string, unknown> }) =>
      Promise.resolve(
        versions.filter((v) => matches(v as never, o.where)).length,
      ),
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
          .filter((v) => matches(v as never, o.where))
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
  const projectRepo = { findOne: () => Promise.resolve(project) };
  const members = {
    manager: {
      findOne: (_: unknown, opts: { where: { id: string } }) =>
        Promise.resolve(
          users[opts.where.id]
            ? { id: opts.where.id, role: users[opts.where.id] }
            : null,
        ),
    },
    find: () => Promise.resolve([]),
    findOne: (opts: { where: { projectId: string; userId: string } }) =>
      Promise.resolve(
        memberships.find(
          (m) =>
            m.projectId === opts.where.projectId &&
            m.userId === opts.where.userId,
        ) ?? null,
      ),
  };
  const access = new ProjectAccessService(members as never, {} as never);
  const projects = new ProjectService(projectRepo as never, access);
  const svc = new ProjectEnvironmentService(repo as never, projects, {
    getOrThrow: () => KEY,
  } as never);
  jest.spyOn(svc, 'ensureDefaults').mockResolvedValue(undefined);
  jest.spyOn(svc, 'ensureProduction').mockResolvedValue(undefined);
  return { svc, rows, usedBy, versions };
}

/** Runs as a request of the given method, like the middleware does. */
function as<T>(method: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ method, path: '/x' }, fn);
}

const REVEAL_PATH = '/projects/p1/environments/e-dev/reveal';

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

describe('ProjectEnvironmentService access rules', () => {
  const { svc } = build();

  describe('list', () => {
    it('shows names, keys and protection to every member, never values', async () => {
      for (const u of ['view', 'dev', 'creator', 'ops']) {
        const list = await as('GET', () => svc.list(u, 'p1'));
        expect(list.map((e) => e.name)).toEqual([
          'development',
          'staging',
          'production',
        ]);
        expect(list.find((e) => e.name === 'production')).toMatchObject({
          protected: true,
          keys: ['SECRET'],
        });
        expect(JSON.stringify(list)).not.toMatch(/secret-value|stg-token/);
      }
    });

    it('answers 404 for someone outside the project', async () => {
      await expect(
        as('GET', () => svc.list('outsider', 'p1')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('reveal and update (writes)', () => {
    const actions: Array<
      [string, (u: string, envId: string) => Promise<unknown>, string]
    > = [
      ['reveal', (u, e) => svc.reveal(u, 'p1', e), 'POST'],
      ['update', (u, e) => svc.update(u, 'p1', e, 'A=1'), 'PUT'],
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
      '%s: developers may use unprotected environments only',
      async (_n, act, method) => {
        await expect(
          as(method, () => act('dev', 'e-dev')),
        ).resolves.toBeDefined();
        await expect(
          as(method, () => act('dev', 'e-stg')),
        ).resolves.toBeDefined();
        await expect(
          as(method, () => act('dev', 'e-prod')),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it.each(actions)(
      '%s: project admins (creator, platform owner/admin) may use protected ones',
      async (_n, act, method) => {
        for (const u of ['creator', 'root', 'ops']) {
          await expect(
            as(method, () => act(u, 'e-prod')),
          ).resolves.toBeDefined();
        }
      },
    );

    it('outsiders get 404', async () => {
      await expect(
        as('POST', () => svc.reveal('outsider', 'p1', 'e-dev')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an environment id from another project is 404, not readable', async () => {
      const other = build([
        { id: 'e-x', projectId: 'p2', name: 'production', protected: true },
      ]);
      await expect(
        as('POST', () => other.svc.reveal('root', 'p1', 'e-x')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('reveal returns the decrypted text and update stores it encrypted with the key list', async () => {
    const { svc: s, rows } = build();
    const revealed = await as('POST', () =>
      s.reveal('creator', 'p1', 'e-prod'),
    );
    expect(revealed).toMatchObject({
      variables: 'SECRET=prod-secret-value',
      keys: ['SECRET'],
    });
    expect(revealed.updatedAt).toBeInstanceOf(Date);
    const view = await as('PUT', () =>
      s.update('creator', 'p1', 'e-prod', 'A=one\n# note\nB=${{project.A}}-x'),
    );
    expect(view.keys).toEqual(['A', 'B']);
    const stored = rows.find((r) => r.id === 'e-prod')!;
    expect(stored.variablesEncrypted).not.toContain('one');
    expect(decryptSecret(stored.variablesEncrypted!, KEY)).toBe(
      'A=one\n# note\nB=${{project.A}}-x',
    );
    // An empty text clears the column.
    await as('PUT', () => s.update('creator', 'p1', 'e-prod', '  \n'));
    expect(stored.variablesEncrypted).toBeNull();
    expect(stored.keys).toEqual([]);
  });

  it('update rejects invalid names, duplicates and bad references with 400', async () => {
    for (const bad of [
      '1BAD=x',
      'NOEQUALS',
      'A=1\nA=2',
      'A=${{project.NOPE}}',
    ]) {
      await expect(
        as('PUT', () => svc.update('creator', 'p1', 'e-dev', bad)),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  describe('create and delete', () => {
    it('developers create unprotected environments; viewers cannot', async () => {
      const { svc: s } = build();
      const created = await as('POST', () => s.create('dev', 'p1', 'qa'));
      expect(created).toMatchObject({ name: 'qa', protected: false, keys: [] });
      await expect(
        as('POST', () => s.create('view', 'p1', 'qa2')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('POST', () => s.create('dev', 'p1', 'qa')),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only project admins delete; production never; a linked one is 409 naming its users', async () => {
      const {
        svc: s,
        usedBy,
        rows,
      } = build([
        { id: 'e-qa', projectId: 'p1', name: 'qa', protected: false },
      ]);
      await expect(
        as('DELETE', () => s.remove('dev', 'p1', 'e-qa')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('DELETE', () => s.remove('creator', 'p1', 'e-prod')),
      ).rejects.toBeInstanceOf(BadRequestException);

      usedBy.push({
        environment_id: 'e-qa',
        kind: 'application',
        id: 'a1',
        name: 'web',
      });
      const err = await as('DELETE', () =>
        s.remove('creator', 'p1', 'e-qa'),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/application "web"/);
      expect(rows.some((r) => r.id === 'e-qa')).toBe(true);

      usedBy.length = 0;
      await as('DELETE', () => s.remove('creator', 'p1', 'e-qa'));
      expect(rows.some((r) => r.id === 'e-qa')).toBe(false);
    });
  });

  describe('variablesFor (resolver and deploys)', () => {
    it('decrypts the linked environment without any actor', async () => {
      const { svc: s } = build();
      expect(
        await s.variablesFor({ projectId: 'p1', environmentId: 'e-stg' }),
      ).toBe('TOKEN=stg-token-value');
    });

    it('falls back to production when there is no link, and to empty when it has no values', async () => {
      const { svc: s } = build();
      expect(await s.variablesFor({ projectId: 'p1' })).toBe(
        'SECRET=prod-secret-value',
      );
      expect(
        await s.variablesFor({ projectId: 'p1', environmentId: 'e-dev' }),
      ).toBe('');
    });
  });

  describe('reveal route (read-only POST) keeps denying viewers', () => {
    it('a viewer is refused by the service even though the route is not a write', async () => {
      const { svc: s } = build();
      for (const env of ['e-dev', 'e-stg', 'e-prod']) {
        await expect(
          runWithRequestContext({ method: 'POST', path: REVEAL_PATH }, () =>
            s.reveal('view', 'p1', env),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('a developer still reveals an unprotected environment on that route', async () => {
      const { svc: s } = build();
      await expect(
        runWithRequestContext({ method: 'POST', path: REVEAL_PATH }, () =>
          s.reveal('dev', 'p1', 'e-dev'),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('API token environment scope', () => {
    const scoped = ['development'];

    it('reveals and updates only the named environments', async () => {
      const { svc: s } = build();
      await expect(
        withToken('POST', REVEAL_PATH, { environments: scoped }, () =>
          s.reveal('creator', 'p1', 'e-dev'),
        ),
      ).resolves.toBeDefined();
      await expect(
        withToken('PUT', '/x', { environments: scoped }, () =>
          s.update('creator', 'p1', 'e-dev', 'A=1'),
        ),
      ).resolves.toBeDefined();
      for (const env of ['e-stg', 'e-prod']) {
        await expect(
          withToken('POST', REVEAL_PATH, { environments: scoped }, () =>
            s.reveal('root', 'p1', env),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          withToken('PUT', '/x', { environments: scoped }, () =>
            s.update('root', 'p1', env, 'A=1'),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('does not widen: a developer token still cannot reach production', async () => {
      const { svc: s } = build();
      await expect(
        withToken('POST', REVEAL_PATH, { environments: ['production'] }, () =>
          s.reveal('dev', 'p1', 'e-prod'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cannot create or delete environments outside the scope', async () => {
      const { svc: s } = build();
      await expect(
        withToken('POST', '/x', { environments: scoped }, () =>
          s.create('creator', 'p1', 'qa'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        withToken('DELETE', '/x', { environments: scoped }, () =>
          s.remove('creator', 'p1', 'e-stg'),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an unscoped token or a session is unaffected', async () => {
      const { svc: s } = build();
      await expect(
        withToken('POST', REVEAL_PATH, {}, () =>
          s.reveal('root', 'p1', 'e-prod'),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('optimistic concurrency on update', () => {
    it('saves when expectedUpdatedAt matches and answers 409 when it does not', async () => {
      const { svc: s } = build();
      const read = await as('POST', () => s.reveal('creator', 'p1', 'e-dev'));
      const stale = read.updatedAt.toISOString();
      const first = await as('PUT', () =>
        s.update('creator', 'p1', 'e-dev', 'A=1', stale),
      );
      expect(first.keys).toEqual(['A']);
      // The same stale version again: someone else saved in between.
      await expect(
        as('PUT', () => s.update('creator', 'p1', 'e-dev', 'A=2', stale)),
      ).rejects.toBeInstanceOf(ConflictException);
      // Without the field the last write wins (older clients).
      await expect(
        as('PUT', () => s.update('creator', 'p1', 'e-dev', 'A=3')),
      ).resolves.toBeDefined();
    });

    it('rejects an unparsable expectedUpdatedAt', async () => {
      await expect(
        as('PUT', () => svc.update('creator', 'p1', 'e-dev', 'A=1', 'nope')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resolveLink with an actor (protection rule)', () => {
    const link = (
      s: ProjectEnvironmentService,
      user: string,
      id: string | undefined,
      currentId?: string,
    ) => as('POST', () => s.resolveLink('p1', id, { userId: user, currentId }));

    it('developers cannot link to a protected environment, admins can', async () => {
      const { svc: s } = build();
      await expect(link(s, 'dev', 'e-prod')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(link(s, 'dev', 'e-stg')).resolves.toBe('e-stg');
      for (const u of ['creator', 'root', 'ops']) {
        await expect(link(s, u, 'e-prod')).resolves.toBe('e-prod');
      }
    });

    it('developers cannot move away from a protected environment, admins can', async () => {
      const { svc: s } = build();
      await expect(link(s, 'dev', 'e-dev', 'e-prod')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(link(s, 'creator', 'e-dev', 'e-prod')).resolves.toBe(
        'e-dev',
      );
    });

    it('keeping the current link is always allowed (an edit that resends it)', async () => {
      const { svc: s } = build();
      await expect(link(s, 'dev', 'e-prod', 'e-prod')).resolves.toBe('e-prod');
    });

    it('without an id: admins get production, developers development', async () => {
      const { svc: s } = build();
      await expect(link(s, 'creator', undefined)).resolves.toBe('e-prod');
      await expect(link(s, 'dev', undefined)).resolves.toBe('e-dev');
    });

    it('without an id and without development a developer gets the oldest unprotected one', async () => {
      const { svc: s, rows } = build();
      rows.splice(
        rows.findIndex((r) => r.id === 'e-dev'),
        1,
      );
      await expect(link(s, 'dev', undefined)).resolves.toBe('e-stg');
    });

    it('a developer gets 403 when only production exists', async () => {
      const { svc: s, rows } = build();
      for (const id of ['e-dev', 'e-stg']) {
        rows.splice(
          rows.findIndex((r) => r.id === id),
          1,
        );
      }
      await expect(link(s, 'dev', undefined)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('no actor (import, background) applies no role rule', async () => {
      const { svc: s } = build();
      await expect(s.resolveLink('p1', 'e-prod')).resolves.toBe('e-prod');
    });
  });

  describe('resolveLink', () => {
    it('accepts an environment of the project, rejects any other with 400', async () => {
      const { svc: s } = build();
      await expect(s.resolveLink('p1', 'e-stg')).resolves.toBe('e-stg');
      await expect(s.resolveLink('p1', 'e-nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(s.resolveLink('p1', undefined)).resolves.toBe('e-prod');
    });
  });

  describe('export and import', () => {
    it('exports values only when asked', async () => {
      const { svc: s } = build();
      const plain = await s.exportAll('p1', false);
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
      const full = await s.exportAll('p1', true);
      expect(full.find((e) => e.name === 'production')?.variables).toBe(
        'SECRET=prod-secret-value',
      );
    });

    it('imports by name, puts an old project.env into production and warns about missing values', async () => {
      const { svc: s, rows } = build();
      rows.length = 0;
      rows.push(
        ...(['development', 'staging', 'production'].map((name, i) => ({
          id: `n${i}`,
          projectId: 'p9',
          name,
          protected: name === 'production',
          keys: [],
          variablesEncrypted: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as unknown as ProjectEnvironment[]),
      );
      const warnings: string[] = [];
      const ids = await s.importAll(
        'p9',
        [
          { name: 'staging', protected: false },
          { name: 'BAD NAME', protected: false },
        ],
        'OLD=1\nbad line\n1X=2',
        warnings,
      );
      expect([...ids.keys()].sort()).toEqual([
        'development',
        'production',
        'staging',
      ]);
      const prod = rows.find((r) => r.name === 'production')!;
      expect(decryptSecret(prod.variablesEncrypted!, KEY)).toBe('OLD=1');
      expect(prod.keys).toEqual(['OLD']);
      expect(warnings.join(' | ')).toMatch(/invalid name/);
      expect(warnings.join(' | ')).toMatch(/without secrets \(staging\)/);
    });
  });
});

describe('ProjectEnvironmentService history, restore, diff, promote and secret flags', () => {
  const dev = {
    userId: 'dev',
    email: 'dev@example.com',
    via: 'session' as const,
  };
  const ci = { userId: 'dev', email: 'dev@example.com', via: 'token' as const };
  const admin = {
    userId: 'creator',
    email: 'admin@example.com',
    via: 'session' as const,
  };

  it('stores a version per real change with a key-level summary and a baseline of the old content', async () => {
    const { svc, versions } = build();
    await as('PUT', () =>
      svc.update(admin, 'p1', 'e-prod', 'SECRET=prod-secret-value\nNEW=1'),
    );
    // Baseline (content before the first recorded change) + the change.
    expect(versions.map((v) => v.action)).toEqual(['baseline', 'edit']);
    expect(versions[1]).toMatchObject({
      authorEmail: 'admin@example.com',
      authorId: 'creator',
      via: 'session',
      summary: { added: ['NEW'], changed: [], removed: [], flags: [] },
    });
    // Texts are encrypted, summaries hold no values.
    expect(versions[1].variablesEncrypted).not.toContain('NEW=1');
    expect(JSON.stringify(versions.map((v) => v.summary))).not.toMatch(
      /prod-secret-value/,
    );
    await as('PUT', () =>
      svc.update(ci, 'p1', 'e-dev', 'A=1', undefined, { action: 'set' }),
    );
    await as('PUT', () => svc.update(ci, 'p1', 'e-dev', 'A=2\nB=1'));
    await as('PUT', () => svc.update(ci, 'p1', 'e-dev', 'B=1'));
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
      svc.update(dev, 'p1', 'e-stg', 'TOKEN=stg-token-value\r\n'),
    );
    expect(versions).toHaveLength(0);
  });

  it('lists versions to every member without any value', async () => {
    const { svc } = build();
    await as('PUT', () =>
      svc.update(admin, 'p1', 'e-prod', 'SECRET=changed-1234'),
    );
    for (const u of ['view', 'dev', 'creator']) {
      const list = await as('GET', () => svc.listVersions(u, 'p1', 'e-prod'));
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({ current: true, action: 'edit' });
      expect(list[1]).toMatchObject({ current: false, action: 'baseline' });
      expect(JSON.stringify(list)).not.toMatch(
        /prod-secret-value|changed-1234/,
      );
    }
    await expect(
      as('GET', () => svc.listVersions('outsider', 'p1', 'e-prod')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reveals a version with the reveal rules (viewer and protected refused)', async () => {
    const { svc, versions } = build();
    await as('PUT', () =>
      svc.update(admin, 'p1', 'e-prod', 'SECRET=changed-1234'),
    );
    const base = versions.find((v) => v.action === 'baseline')!;
    const shown = await as('POST', () =>
      svc.revealVersion('creator', 'p1', 'e-prod', base.id),
    );
    expect(shown.variables).toBe('SECRET=prod-secret-value');
    for (const u of ['view', 'dev']) {
      await expect(
        as('POST', () => svc.revealVersion(u, 'p1', 'e-prod', base.id)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('restore writes the old text as a new version, brings the flags back and never rewrites history', async () => {
    const { svc, versions, rows } = build();
    await as('PUT', () =>
      svc.update(dev, 'p1', 'e-dev', 'PIN=ab1\nHOST=a', undefined, {
        flags: { PIN: true },
      }),
    );
    await as('PUT', () =>
      svc.update(dev, 'p1', 'e-dev', 'HOST=b', undefined, {}),
    );
    const first = versions.find((v) => v.action === 'edit')!;
    const countBefore = versions.length;
    const view = await as('POST', () =>
      svc.restoreVersion(dev, 'p1', 'e-dev', first.id),
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
        svc.restoreVersion(dev, 'p1', 'e-dev', versions.at(-1)!.id),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restore follows the edit rules and honours expectedUpdatedAt', async () => {
    const { svc, versions, rows } = build();
    await as('PUT', () =>
      svc.update(admin, 'p1', 'e-prod', 'SECRET=changed-1234'),
    );
    const base = versions.find((v) => v.action === 'baseline')!;
    await expect(
      as('POST', () => svc.restoreVersion(dev, 'p1', 'e-prod', base.id)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      as('POST', () => svc.restoreVersion('view', 'p1', 'e-prod', base.id)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const stale = new Date(
      rows.find((r) => r.id === 'e-prod')!.updatedAt.getTime() - 5000,
    ).toISOString();
    await expect(
      as('POST', () =>
        svc.restoreVersion(admin, 'p1', 'e-prod', base.id, stale),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const fresh = rows.find((r) => r.id === 'e-prod')!.updatedAt.toISOString();
    await expect(
      as('POST', () =>
        svc.restoreVersion(admin, 'p1', 'e-prod', base.id, fresh),
      ),
    ).resolves.toBeDefined();
    // A version of another environment is a 404.
    await expect(
      as('POST', () => svc.restoreVersion(dev, 'p1', 'e-dev', base.id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps only the newest versions of an environment', async () => {
    const { svc, versions } = build();
    for (let i = 1; i <= ENV_VERSION_KEEP + 7; i++) {
      await as('PUT', () => svc.update(dev, 'p1', 'e-dev', `N=${i}`));
    }
    const mine = versions.filter((v) => v.environmentId === 'e-dev');
    expect(mine).toHaveLength(ENV_VERSION_KEEP);
    const list = await as('GET', () => svc.listVersions('dev', 'p1', 'e-dev'));
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
          'p1',
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
        svc.update(dev, 'p1', 'e-dev', 'API_KEY=abc\nHOST=b\nDB_PASSWORD=x'),
      );
      expect(v2.secretKeys).toEqual(['API_KEY']);
      const v3 = await as('PUT', () =>
        svc.update(dev, 'p1', 'e-dev', 'HOST=b', undefined, {}),
      );
      expect(v3.secretKeys).toEqual([]);
      expect(rows.find((r) => r.id === 'e-dev')!.secretFlags).toEqual({});
      // null clears a flag.
      const v4 = await as('PUT', () =>
        svc.update(dev, 'p1', 'e-dev', 'TOKEN=t', undefined, {
          flags: { TOKEN: null },
        }),
      );
      expect(v4.secretKeys).toEqual([]);
    });

    it('rejects a flag for a variable that is not in the text', async () => {
      const { svc } = build();
      await expect(
        as('PUT', () =>
          svc.update(dev, 'p1', 'e-dev', 'A=1', undefined, {
            flags: { B: true },
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lists secret keys to every member and reveals the flags with the values', async () => {
      const { svc } = build();
      await as('PUT', () => svc.update(dev, 'p1', 'e-dev', 'A_TOKEN=1'));
      const list = await as('GET', () => svc.list('view', 'p1'));
      expect(list.find((e) => e.name === 'development')!.secretKeys).toEqual([
        'A_TOKEN',
      ]);
      const shown = await as('POST', () => svc.reveal(dev, 'p1', 'e-dev'));
      expect(shown.secretKeys).toEqual(['A_TOKEN']);
    });

    it('variablesAndFlagsFor hands the resolver the flags', async () => {
      const { svc } = build();
      await as('PUT', () =>
        svc.update(dev, 'p1', 'e-dev', 'A=1', undefined, {
          flags: { A: true },
        }),
      );
      expect(
        await svc.variablesAndFlagsFor({
          projectId: 'p1',
          environmentId: 'e-dev',
        }),
      ).toEqual({ text: 'A=1', flags: { A: true } });
    });
  });

  describe('diff', () => {
    it('compares values server-side for someone who may reveal both sides, never returning values', async () => {
      const { svc } = build();
      await as('PUT', () =>
        svc.update(
          admin,
          'p1',
          'e-prod',
          'SECRET=prod-secret-value\nSAME=1\nDIFF=prod',
        ),
      );
      await as('PUT', () =>
        svc.update(admin, 'p1', 'e-stg', 'SAME=1\nDIFF=stg\nONLY_STG=x'),
      );
      const d = await as('GET', () =>
        svc.diff('creator', 'p1', 'staging', 'production'),
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
        svc.diff('dev', 'p1', 'staging', 'production'),
      );
      expect(d.comparable).toBe(false);
      expect(d.different).toBeNull();
      expect(d.same).toBeNull();
      expect(d.onlyInFrom).toEqual(['TOKEN']);
      expect(d.onlyInTo).toEqual(['SECRET']);
      // Two unprotected environments compare fully; viewers never see values compared.
      expect(
        (await as('GET', () => svc.diff('dev', 'p1', 'development', 'staging')))
          .comparable,
      ).toBe(true);
      expect(
        (
          await as('GET', () =>
            svc.diff('view', 'p1', 'development', 'staging'),
          )
        ).comparable,
      ).toBe(false);
    });

    it('treats a token limited to other environments as unable to reveal', async () => {
      const { svc } = build();
      const d = await withToken(
        'GET',
        '/x',
        { environments: ['development'] },
        () => svc.diff('dev', 'p1', 'development', 'staging'),
      );
      expect(d.comparable).toBe(false);
    });

    it('answers 404 for an unknown name', async () => {
      const { svc } = build();
      await expect(
        as('GET', () => svc.diff('dev', 'p1', 'nope', 'staging')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('promote', () => {
    it('copies chosen keys: keeps the target comments and order, appends new keys, brings the flag, stores a version', async () => {
      const { svc, rows, versions } = build();
      await as('PUT', () =>
        svc.update(
          admin,
          'p1',
          'e-stg',
          'A=new\nNEW_TOKEN=s3\nOTHER=o',
          undefined,
          {
            flags: { A: false },
          },
        ),
      );
      await as('PUT', () =>
        svc.update(admin, 'p1', 'e-prod', '# prod config\nA=old\n\nKEEP=1'),
      );
      const out = await as('POST', () =>
        svc.promote(admin, 'p1', 'e-prod', 'e-stg', ['A', 'NEW_TOKEN']),
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
        as('POST', () => svc.promote(dev, 'p1', 'e-prod', 'e-stg', ['TOKEN'])),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('POST', () => svc.promote(dev, 'p1', 'e-stg', 'e-prod', ['SECRET'])),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('POST', () =>
          svc.promote('view', 'p1', 'e-dev', 'e-stg', ['TOKEN']),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        as('POST', () => svc.promote(dev, 'p1', 'e-dev', 'e-stg', ['TOKEN'])),
      ).resolves.toBeDefined();
    });

    it('refuses a missing key, an empty list, the same environment and a stale version', async () => {
      const { svc, rows } = build();
      await expect(
        as('POST', () => svc.promote(dev, 'p1', 'e-dev', 'e-stg', ['NOPE'])),
      ).rejects.toThrow(/Not set in "staging": NOPE/);
      await expect(
        as('POST', () => svc.promote(dev, 'p1', 'e-dev', 'e-stg', [])),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        as('POST', () => svc.promote(dev, 'p1', 'e-dev', 'e-dev', ['A'])),
      ).rejects.toBeInstanceOf(BadRequestException);
      const stale = new Date(
        rows.find((r) => r.id === 'e-dev')!.updatedAt.getTime() - 1000,
      ).toISOString();
      await expect(
        as('POST', () =>
          svc.promote(dev, 'p1', 'e-dev', 'e-stg', ['TOKEN'], stale),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a result that fails validation, such as a dangling project reference', async () => {
      const { svc } = build();
      await as('PUT', () =>
        svc.update(dev, 'p1', 'e-stg', 'BASE=1\nURL=${{project.BASE}}/x'),
      );
      await expect(
        as('POST', () => svc.promote(dev, 'p1', 'e-dev', 'e-stg', ['URL'])),
      ).rejects.toThrow(/no variable "BASE"/);
    });
  });
});
