import { decryptSecret } from '../docker/secret.util';
import { extractNotes } from './env-text';
import type { SqlRunner } from './variable-set-migration';

/**
 * Data step of the VariableNotes migration: fills the new plaintext `notes`
 * column of every set environment and every stored version from its
 * decrypted text (`extractNotes`). Kept free of Nest/TypeORM so a spec can
 * drive it with a fake runner; the migration file owns the DDL.
 *
 * Rows without content keep `{}`. When any row has content the key is
 * required (the notes can only be read by decrypting); a key that cannot
 * decrypt a row fails the whole migration (it runs in one transaction).
 * Re-runnable: it only rewrites the `notes` column.
 */
export async function backfillVariableNotes(
  db: SqlRunner,
  encryptionKey: string | undefined,
): Promise<{ environments: number; versions: number }> {
  const result = { environments: 0, versions: 0 };
  const tables = [
    ['variable_set_environments', 'environments'],
    ['variable_set_environment_versions', 'versions'],
  ] as const;
  for (const [table, counter] of tables) {
    const rows = (await db.query(
      `SELECT "id", "variables_encrypted" FROM "${table}"
       WHERE "variables_encrypted" IS NOT NULL`,
    )) as Array<{ id: string; variables_encrypted: string }>;
    if (rows.length === 0) continue;
    if (!encryptionKey) {
      throw new Error(
        'ENCRYPTION_KEY is required to read the notes of stored variable set environments; set it and run the migration again',
      );
    }
    for (const row of rows) {
      let text: string;
      try {
        text = decryptSecret(row.variables_encrypted, encryptionKey);
      } catch {
        throw new Error(
          'Could not decrypt stored environment variables: ENCRYPTION_KEY differs from the one they were saved with',
        );
      }
      const notes = extractNotes(text);
      if (Object.keys(notes).length === 0) continue;
      await db.query(`UPDATE "${table}" SET "notes" = $1 WHERE "id" = $2`, [
        JSON.stringify(notes),
        row.id,
      ]);
      result[counter]++;
    }
  }
  return result;
}
