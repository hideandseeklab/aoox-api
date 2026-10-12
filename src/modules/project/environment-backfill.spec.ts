import { decryptSecret } from '../docker/secret.util';
import { backfillEnvironments, SqlRunner } from './environment-backfill';

const KEY = 'a-test-key';

/** Records statements; `pending` mimics the SELECT of projects still to import. */
function runner(pending: Array<{ id: string; env: string }>) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const db: SqlRunner = {
    query: (sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve(/^\s*SELECT p\./.test(sql) ? pending : []);
    },
  };
  return { db, calls };
}

describe('backfillEnvironments', () => {
  it('encrypts each project env into production and links apps and stacks', async () => {
    const { db, calls } = runner([{ id: 'p1', env: 'A=1\nB=2' }]);
    expect(await backfillEnvironments(db, KEY)).toEqual({ imported: 1 });

    const update = calls.find((c) => /SET "variables_encrypted"/.test(c.sql))!;
    const [cipher, keys, projectId] = update.params as string[];
    expect(cipher).not.toContain('A=1');
    expect(decryptSecret(cipher, KEY)).toBe('A=1\nB=2');
    expect(keys).toBe('["A","B"]');
    expect(projectId).toBe('p1');
    // Only an empty production is written, so a rerun cannot overwrite edits.
    expect(update.sql).toMatch(/"variables_encrypted" IS NULL/);

    const links = calls.filter((c) => /SET "environment_id"/.test(c.sql));
    expect(links).toHaveLength(2);
    expect(links.every((c) => /"environment_id" IS NULL/.test(c.sql))).toBe(
      true,
    );
  });

  it('is idempotent: defaults use ON CONFLICT DO NOTHING and a second run finds nothing to import', async () => {
    const first = runner([{ id: 'p1', env: 'A=1' }]);
    await backfillEnvironments(first.db, KEY);
    expect(first.calls[0].sql).toMatch(/ON CONFLICT .* DO NOTHING/);

    const second = runner([]);
    expect(await backfillEnvironments(second.db, KEY)).toEqual({
      imported: 0,
    });
    expect(
      second.calls.some((c) => /SET "variables_encrypted"/.test(c.sql)),
    ).toBe(false);
  });

  it('needs the encryption key only when some project has an env', async () => {
    await expect(
      backfillEnvironments(runner([]).db, undefined),
    ).resolves.toEqual({ imported: 0 });
    const { db, calls } = runner([{ id: 'p1', env: 'A=1' }]);
    await expect(backfillEnvironments(db, undefined)).rejects.toThrow(
      /ENCRYPTION_KEY is required/,
    );
    expect(calls.some((c) => /SET "variables_encrypted"/.test(c.sql))).toBe(
      false,
    );
  });
});
