import { encryptSecret } from '../docker/secret.util';
import { keysOf } from './env-text';

/** Just what the backfill needs from a TypeORM QueryRunner (easy to fake in specs). */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<any>;
}

/**
 * Used by the ProjectEnvironments migration, written to be re-runnable:
 * - every project gets development / staging / production (existing rows kept);
 * - a project's old shared env (`projects.env`) is copied, encrypted, into its
 *   production environment, but only while production is still empty;
 * - applications and compose stacks without an environment point to their
 *   project's production.
 * Encryption happens here because the key (ENCRYPTION_KEY) is only known to
 * the process, not to SQL. A project whose env is blank needs no key.
 */
export async function backfillEnvironments(
  db: SqlRunner,
  encryptionKey: string | undefined,
): Promise<{ imported: number }> {
  await db.query(
    `INSERT INTO "project_environments" ("project_id", "name", "protected")
     SELECT p."id", e."name", e."protected"
     FROM "projects" p
     CROSS JOIN (VALUES ('development', false), ('staging', false), ('production', true)) AS e("name", "protected")
     ON CONFLICT ("project_id", "name") DO NOTHING`,
  );

  const rows = (await db.query(
    `SELECT p."id", p."env"
     FROM "projects" p
     JOIN "project_environments" e
       ON e."project_id" = p."id" AND e."name" = 'production'
     WHERE btrim(p."env") <> '' AND e."variables_encrypted" IS NULL`,
  )) as Array<{ id: string; env: string }>;
  if (rows.length > 0 && !encryptionKey) {
    throw new Error(
      'ENCRYPTION_KEY is required to move project environment variables into encrypted storage; set it and run the migration again',
    );
  }
  for (const row of rows) {
    await db.query(
      `UPDATE "project_environments"
       SET "variables_encrypted" = $1, "keys" = $2::jsonb
       WHERE "project_id" = $3 AND "name" = 'production' AND "variables_encrypted" IS NULL`,
      [
        encryptSecret(row.env, encryptionKey as string),
        JSON.stringify(keysOf(row.env)),
        row.id,
      ],
    );
  }

  for (const table of ['applications', 'compose_apps']) {
    await db.query(
      `UPDATE "${table}" t
       SET "environment_id" = (
         SELECT e."id" FROM "project_environments" e
         WHERE e."project_id" = t."project_id" AND e."name" = 'production'
       )
       WHERE t."environment_id" IS NULL`,
    );
  }
  return { imported: rows.length };
}
