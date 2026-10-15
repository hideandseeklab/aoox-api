import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { VariableSetEnvironment } from './variable-set-environment.entity';
import { VariableSetEnvironmentService } from './variable-set-environment.service';
import { VariableSetLink } from './variable-set-link.entity';
import { VariableSetProject } from './variable-set-project.entity';
import { VariableSet } from './variable-set.entity';
import { VariableSetTransferService } from './variable-set-transfer.service';

const KEY = 'transfer-test-key';

function valueIn(actual: unknown, expected: unknown): boolean {
  const op = expected as { _type?: string; _value?: unknown[] } | null;
  if (op && typeof op === 'object' && op._type === 'in') {
    return (op._value ?? []).includes(actual);
  }
  return actual === expected;
}

function build(platform = false) {
  let n = 0;
  const tables = new Map<unknown, Array<Record<string, unknown>>>([
    [
      VariableSet,
      [
        { id: 's-common', name: 'Common', slug: 'common', sharedWithAll: true },
        {
          id: 's-private',
          name: 'Private',
          slug: 'private',
          sharedWithAll: false,
        },
        { id: 's-shop', name: 'Shop', slug: 'shop', sharedWithAll: false },
      ],
    ],
    [
      VariableSetEnvironment,
      [
        {
          id: 'c-prod',
          variableSetId: 's-common',
          name: 'production',
          secretFlags: {},
          keys: [],
        },
        {
          id: 'p-prod',
          variableSetId: 's-private',
          name: 'production',
          secretFlags: {},
          keys: [],
        },
        {
          id: 'shop-stg',
          variableSetId: 's-shop',
          name: 'staging',
          secretFlags: { A: true },
          keys: ['A'],
          variablesEncrypted: encryptSecret('A=1', KEY),
          protected: false,
        },
      ],
    ],
    [VariableSetProject, [{ variableSetId: 's-shop', projectId: 'old' }]],
    [
      VariableSetLink,
      [
        {
          environmentId: 'shop-stg',
          applicationId: 'a1',
          composeAppId: null,
          position: 1,
        },
        {
          environmentId: 'c-prod',
          applicationId: 'a1',
          composeAppId: null,
          position: 0,
        },
        {
          environmentId: 'c-prod',
          applicationId: null,
          composeAppId: 'c1',
          position: 0,
        },
      ],
    ],
  ]);
  const rows = (e: unknown) => tables.get(e) ?? [];
  const matchesWhere = (r: Record<string, unknown>, where: unknown): boolean =>
    Array.isArray(where)
      ? where.some((w) => matchesWhere(r, w))
      : Object.entries(where as object).every(([k, v]) => valueIn(r[k], v));
  const manager = {
    find: (
      e: unknown,
      o?: { where?: unknown; order?: { position?: string } },
    ) => {
      let out = o?.where
        ? rows(e).filter((r) => matchesWhere(r, o.where))
        : [...rows(e)];
      if (o?.order?.position) {
        out = out.sort(
          (a, b) => (a.position as number) - (b.position as number),
        );
      }
      return Promise.resolve(out);
    },
    create: (_: unknown, v: object) => ({ ...v }),
    save: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
      const list = Array.isArray(v) ? v : [v];
      for (const r of list) {
        r.id ??= `new-${++n}`;
        const table = 'slug' in r ? VariableSet : VariableSetEnvironment;
        rows(table).push(r);
      }
      return Promise.resolve(v);
    },
    insert: (e: unknown, v: object | object[]) => {
      rows(e).push(
        ...((Array.isArray(v) ? v : [v]) as Array<Record<string, unknown>>),
      );
      return Promise.resolve();
    },
    transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager),
    createQueryBuilder: () => {
      const qb = {
        insert: () => qb,
        into: () => qb,
        values: (v: Record<string, unknown>) => {
          rows(VariableSetProject).push(v);
          return qb;
        },
        orIgnore: () => qb,
        execute: () => Promise.resolve(),
      };
      return qb;
    },
  };
  const access = {
    sets: { manager },
    context: () =>
      Promise.resolve({
        platform,
        roles: platform ? 'all' : new Map(),
      }),
  };
  const envRepo = {
    find: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        rows(VariableSetEnvironment).filter((r) => matchesWhere(r, where)),
      ),
    findOne: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        rows(VariableSetEnvironment).find((r) => matchesWhere(r, where)) ??
          null,
      ),
  };
  const environments = new VariableSetEnvironmentService(
    envRepo as never,
    access as never,
    { getOrThrow: () => KEY } as never,
  );
  const svc = new VariableSetTransferService(access as never, environments);
  return { svc, rows };
}

describe('VariableSetTransferService', () => {
  it('exports links by set and environment name in order; whole sets only with secrets', async () => {
    const { svc } = build();
    const plain = await svc.exportFor('old', false, ['a1'], ['c1']);
    expect(plain.applications.get('a1')).toEqual([
      { set: 'Common', environment: 'production' },
      { set: 'Shop', environment: 'staging' },
    ]);
    expect(plain.composeApps.get('c1')).toEqual([
      { set: 'Common', environment: 'production' },
    ]);
    expect(plain.sets).toBeUndefined();
    const full = await svc.exportFor('old', true, ['a1'], ['c1']);
    // Shared with the project, or linked by one of its owners.
    expect(full.sets!.map((s) => s.name)).toEqual(['Common', 'Shop']);
    expect(full.sets![1].environments[0]).toMatchObject({
      name: 'staging',
      variables: 'A=1',
      secretKeys: ['A'],
    });
  });

  it('imports new sets shared with the new project, reuses existing ones without overwriting, links by name', async () => {
    const { svc, rows } = build();
    const warnings: string[] = [];
    const sets = await svc.importFor(
      'new',
      'Copy',
      'member-user',
      [
        {
          name: 'Common',
          environments: [
            { name: 'production', protected: true, variables: 'X=overwrite' },
          ],
        },
        {
          name: 'Fresh',
          slug: 'fresh',
          environments: [
            {
              name: 'production',
              protected: true,
              variables: '# Section\n\n# J doubled\nK=${{project.J}}\nJ=1',
              secretKeys: ['K'],
            },
          ],
        },
      ],
      {},
      warnings,
    );
    const fresh = rows(VariableSet).find((s) => s.name === 'Fresh')!;
    expect(fresh.slug).toBe('fresh');
    expect(rows(VariableSetProject)).toContainEqual({
      variableSetId: fresh.id,
      projectId: 'new',
    });
    const freshEnv = rows(VariableSetEnvironment).find(
      (e) => e.variableSetId === fresh.id,
    )!;
    expect(decryptSecret(freshEnv.variablesEncrypted as string, KEY)).toBe(
      '# J doubled\nK=${{vars.J}}\nJ=1',
    );
    // The note travels with its key; the standalone section comment does not.
    expect(freshEnv.notes).toEqual({ K: 'J doubled' });
    expect(freshEnv.protected).toBe(true);
    expect(freshEnv.secretFlags).toEqual({ K: true });
    expect(warnings.join(' | ')).toMatch(/"Common": already exists/);

    const ids = sets.linksFor(
      [
        { set: 'Common', environment: 'production' },
        { set: 'Fresh', environment: 'production' },
        { set: 'Private', environment: 'production' },
        { set: 'Gone', environment: 'x' },
        { set: 'Fresh', environment: 'nope' },
      ],
      undefined,
      'application "web"',
    );
    expect(ids).toEqual(['c-prod', freshEnv.id]);
    const text = warnings.join(' | ');
    expect(text).toMatch(
      /"Private" is not shared with this project, not linked/,
    );
    expect(text).toMatch(/"Gone" not found/);
    expect(text).toMatch(
      /environment "nope" of variable set "Fresh" not found/,
    );
    await sets.save('application', 'a9', ids);
    expect(
      rows(VariableSetLink).filter((l) => l.applicationId === 'a9'),
    ).toEqual([
      {
        environmentId: 'c-prod',
        position: 0,
        applicationId: 'a9',
        composeAppId: null,
      },
      {
        environmentId: freshEnv.id,
        position: 1,
        applicationId: 'a9',
        composeAppId: null,
      },
    ]);
  });

  it('an instance admin importer shares an existing set with the new project', async () => {
    const { svc, rows } = build(true);
    const warnings: string[] = [];
    const sets = await svc.importFor(
      'new',
      'Copy',
      'root',
      undefined,
      {},
      warnings,
    );
    const ids = sets.linksFor(
      [{ set: 'Private', environment: 'production' }],
      undefined,
      'x',
    );
    expect(ids).toEqual(['p-prod']);
    await sets.save('compose', 'c9', ids);
    expect(rows(VariableSetProject)).toContainEqual({
      variableSetId: 's-private',
      projectId: 'new',
    });
    expect(warnings.join(' | ')).toMatch(/shared with the imported project/);
  });

  it('old files: non-empty environments become one set named after the project; links follow the old environment', async () => {
    const { svc, rows } = build();
    const warnings: string[] = [];
    const sets = await svc.importFor(
      'new',
      'Shop',
      'member-user',
      undefined,
      {
        environments: [
          { name: 'development', protected: false, variables: '' },
          {
            name: 'staging',
            protected: false,
            variables: 'A=${{project.B}}\nB=1',
          },
          { name: 'production', protected: true },
        ],
        projectEnv: 'OLD=1',
      },
      warnings,
    );
    const legacy = rows(VariableSet).find((s) => s.name === 'Shop (2)')!;
    expect(legacy).toBeDefined();
    const envs = rows(VariableSetEnvironment).filter(
      (e) => e.variableSetId === legacy.id,
    );
    expect(envs.map((e) => e.name).sort()).toEqual(['production', 'staging']);
    const prod = envs.find((e) => e.name === 'production')!;
    expect(decryptSecret(prod.variablesEncrypted as string, KEY)).toBe('OLD=1');
    expect(sets.linksFor(undefined, 'staging', 'a')).toEqual([
      envs.find((e) => e.name === 'staging')!.id,
    ]);
    expect(sets.linksFor(undefined, null, 'b')).toEqual([prod.id]);
    expect(sets.linksFor(undefined, 'development', 'c')).toEqual([]);
    expect(warnings.join(' | ')).toMatch(
      /environments without variables are not imported \(development\)/,
    );
    expect(warnings.join(' | ')).toMatch(
      /became the variable set "Shop \(2\)"/,
    );
  });
});
