import { encryptSecret } from '../docker/secret.util';
import { backfillVariableNotes } from './variable-set-notes-migration';
import type { SqlRunner } from './variable-set-migration';

const KEY = 'notes-migration-key';

function fakeDb(rows: Record<string, Array<{ id: string; text: string }>>) {
  const updates: Array<{ table: string; id: string; notes: unknown }> = [];
  const db: SqlRunner = {
    query(sql: string, params?: unknown[]) {
      const table = /"(variable_set_[a-z_]+)"/.exec(sql)?.[1] ?? '';
      if (sql.startsWith('SELECT')) {
        return Promise.resolve(
          (rows[table] ?? []).map((r) => ({
            id: r.id,
            variables_encrypted: encryptSecret(r.text, KEY),
          })),
        );
      }
      updates.push({
        table,
        id: params?.[1] as string,
        notes: JSON.parse(params?.[0] as string),
      });
      return Promise.resolve([]);
    },
  };
  return { db, updates };
}

describe('backfillVariableNotes', () => {
  it('fills notes of environments and versions from their decrypted text', async () => {
    const { db, updates } = fakeDb({
      variable_set_environments: [
        { id: 'e1', text: '# Base URL\nAPI=http://x\nB=2' },
        { id: 'e2', text: 'NO_NOTES=1' },
      ],
      variable_set_environment_versions: [
        { id: 'v1', text: '# Section\n\n# old\nAPI=1' },
      ],
    });
    await expect(backfillVariableNotes(db, KEY)).resolves.toEqual({
      environments: 1,
      versions: 1,
    });
    expect(updates).toEqual([
      {
        table: 'variable_set_environments',
        id: 'e1',
        notes: { API: 'Base URL' },
      },
      {
        table: 'variable_set_environment_versions',
        id: 'v1',
        notes: { API: 'old' },
      },
    ]);
  });

  it('needs no key when nothing is stored', async () => {
    const { db } = fakeDb({});
    await expect(backfillVariableNotes(db, undefined)).resolves.toEqual({
      environments: 0,
      versions: 0,
    });
  });

  it('fails clearly without a key or with a different one', async () => {
    const { db } = fakeDb({
      variable_set_environments: [{ id: 'e1', text: '# n\nA=1' }],
    });
    await expect(backfillVariableNotes(db, undefined)).rejects.toThrow(
      'ENCRYPTION_KEY is required',
    );
    await expect(backfillVariableNotes(db, 'other-key')).rejects.toThrow(
      'ENCRYPTION_KEY differs',
    );
  });
});
