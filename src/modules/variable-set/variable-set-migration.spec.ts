import { decryptSecret, encryptSecret } from '../docker/secret.util';
import {
  migrateEnvironmentsToSets,
  planSets,
  rewriteEncrypted,
  SqlRunner,
} from './variable-set-migration';

const KEY = 'migration-test-key';

describe('planSets', () => {
  it('one set per project with non-empty environments, named after it, deduplicated', () => {
    const plan = planSets(
      [
        { id: 'p1', name: 'Shop' },
        { id: 'p2', name: 'shop' },
        { id: 'p3', name: 'Empty' },
        { id: 'p4', name: 'Blog' },
      ],
      [
        { id: 'e1', project_id: 'p1' },
        { id: 'e2', project_id: 'p1' },
        { id: 'e3', project_id: 'p2' },
        { id: 'e4', project_id: 'p4' },
      ],
      ['Blog'],
      ['blog'],
    );
    expect(plan).toEqual([
      {
        projectId: 'p1',
        name: 'Shop',
        slug: 'shop',
        environmentIds: ['e1', 'e2'],
      },
      {
        projectId: 'p2',
        name: 'shop (2)',
        slug: 'shop-2',
        environmentIds: ['e3'],
      },
      {
        projectId: 'p4',
        name: 'Blog (2)',
        slug: 'blog-2',
        environmentIds: ['e4'],
      },
    ]);
  });
});

describe('rewriteEncrypted', () => {
  it('rewrites project. references and keeps the ciphertext when nothing changes', () => {
    const plain = encryptSecret('A=1', KEY);
    expect(rewriteEncrypted(plain, KEY)).toBe(plain);
    const out = rewriteEncrypted(encryptSecret('B=${{project.A}}', KEY), KEY);
    expect(decryptSecret(out, KEY)).toBe('B=${{vars.A}}');
  });

  it('fails clearly with the wrong key', () => {
    expect(() => rewriteEncrypted(encryptSecret('A=1', KEY), 'other')).toThrow(
      /ENCRYPTION_KEY differs/,
    );
  });
});

/** Answers the migration's queries from in-memory tables and records writes. */
function fakeDb(data: {
  projects: Array<{ id: string; name: string }>;
  envs: Array<Record<string, unknown>>;
  versions?: Array<Record<string, unknown>>;
  tokens?: Array<{ id: string; environments: unknown }>;
}) {
  const writes: Array<{ sql: string; params?: unknown[] }> = [];
  let n = 0;
  const db: SqlRunner = {
    query: (sql: string, params?: unknown[]) => {
      const s = sql.replace(/\s+/g, ' ');
      if (s.startsWith('SELECT "id", "name" FROM "projects"')) {
        return Promise.resolve(data.projects);
      }
      if (s.includes('FROM "project_environments"')) {
        return Promise.resolve(data.envs);
      }
      if (s.startsWith('SELECT "name", "slug" FROM "variable_sets"')) {
        return Promise.resolve([]);
      }
      if (s.includes('FROM "project_environment_versions"')) {
        return Promise.resolve(data.versions ?? []);
      }
      if (s.includes('FROM "api_tokens"')) {
        return Promise.resolve(data.tokens ?? []);
      }
      writes.push({ sql: s, params });
      if (s.startsWith('INSERT INTO "variable_sets"')) {
        return Promise.resolve([{ id: `set-${++n}` }]);
      }
      if (s.startsWith('INSERT INTO "variable_set_links"')) {
        return Promise.resolve([{ id: 'l' }]);
      }
      return Promise.resolve([]);
    },
  };
  return { db, writes };
}

describe('migrateEnvironmentsToSets', () => {
  const env = (id: string, projectId: string, name: string, text: string) => ({
    id,
    project_id: projectId,
    name,
    protected: name === 'production',
    variables_encrypted: encryptSecret(text, KEY),
    keys: ['A'],
    secret_flags: { A: true },
    created_at: new Date(),
    updated_at: new Date(),
  });

  it('copies non-empty environments with their ids into one set per project and rewrites references', async () => {
    const { db, writes } = fakeDb({
      projects: [
        { id: 'p1', name: 'Shop' },
        { id: 'p2', name: 'Quiet' },
      ],
      envs: [
        env('e-prod', 'p1', 'production', 'A=1\nB=${{project.A}}'),
        env('e-stg', 'p1', 'staging', 'A=2'),
      ],
      versions: [
        {
          id: 'v1',
          environment_id: 'e-prod',
          variables_encrypted: encryptSecret('B=${{ project.A }}', KEY),
          secret_flags: {},
          author_id: null,
          author_email: null,
          via: 'session',
          action: 'edit',
          detail: null,
          summary: { added: ['B'], changed: [], removed: [], flags: [] },
          created_at: new Date(),
        },
      ],
      tokens: [
        { id: 't1', environments: ['development', 'staging'] },
        { id: 't2', environments: ['BAD NAME'] },
      ],
    });
    const result = await migrateEnvironmentsToSets(db, KEY);
    expect(result).toMatchObject({ sets: 1, environments: 2 });
    const setInsert = writes.find((w) =>
      w.sql.startsWith('INSERT INTO "variable_sets"'),
    )!;
    expect(setInsert.params).toEqual(['Shop', 'shop']);
    expect(
      writes.find((w) =>
        w.sql.startsWith('INSERT INTO "variable_set_projects"'),
      )!.params,
    ).toEqual(['set-1', 'p1']);
    const envInserts = writes.filter((w) =>
      w.sql.startsWith('INSERT INTO "variable_set_environments"'),
    );
    expect(envInserts.map((w) => w.params![0])).toEqual(['e-prod', 'e-stg']);
    expect(decryptSecret(envInserts[0].params![4] as string, KEY)).toBe(
      'A=1\nB=${{vars.A}}',
    );
    expect(envInserts[0].params![3]).toBe(true); // protected kept
    expect(envInserts[0].params![6]).toBe('{"A":true}'); // flags kept
    const version = writes.find((w) =>
      w.sql.startsWith('INSERT INTO "variable_set_environment_versions"'),
    )!;
    expect(decryptSecret(version.params![2] as string, KEY)).toBe(
      'B=${{ vars.A }}',
    );
    // Links at position 0 from the old environment_id, env text rewritten in SQL.
    expect(
      writes.filter((w) =>
        w.sql.startsWith('INSERT INTO "variable_set_links"'),
      ),
    ).toHaveLength(2);
    expect(writes.some((w) => w.sql.includes('regexp_replace'))).toBe(true);
    const tokenWrites = writes.filter((w) =>
      w.sql.startsWith('UPDATE "api_tokens"'),
    );
    expect(tokenWrites.map((w) => w.params)).toEqual([
      ['["*/development","*/staging"]', 't1'],
      ['["*/-"]', 't2'], // inexpressible: matches nothing rather than everything
    ]);
  });

  it('needs ENCRYPTION_KEY as soon as an environment has content', async () => {
    const { db } = fakeDb({
      projects: [{ id: 'p1', name: 'Shop' }],
      envs: [env('e1', 'p1', 'production', 'A=1')],
    });
    await expect(migrateEnvironmentsToSets(db, undefined)).rejects.toThrow(
      /ENCRYPTION_KEY is required/,
    );
  });

  it('works without a key when there is nothing to move', async () => {
    const { db } = fakeDb({ projects: [{ id: 'p1', name: 'Shop' }], envs: [] });
    await expect(
      migrateEnvironmentsToSets(db, undefined),
    ).resolves.toMatchObject({
      sets: 0,
    });
  });
});
