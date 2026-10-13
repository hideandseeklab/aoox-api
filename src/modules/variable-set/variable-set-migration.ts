import { decryptSecret, encryptSecret } from '../docker/secret.util';
import { rewriteProjectReferences } from './env-text';
import {
  slugifySetName,
  uniqueSetName,
  uniqueSetSlug,
} from './variable-set-names';
import { scopesFromEnvironmentNames } from './variable-scope';

/**
 * Data steps of the VariableSets migration (project environments become
 * variable sets). Kept free of Nest/TypeORM so specs can drive them with a
 * fake runner; the migration file owns the DDL.
 */

/** Just what the steps need from a TypeORM QueryRunner. */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<any>;
}

export interface ProjectRow {
  id: string;
  name: string;
}

export interface EnvironmentRow {
  id: string;
  project_id: string;
}

export interface PlannedSet {
  projectId: string;
  name: string;
  slug: string;
  environmentIds: string[];
}

/**
 * Pure: one set per project that has at least one non-empty environment,
 * named after the project (deduplicated with ` (2)`, …, case-insensitively)
 * with a unique slug. `taken*` = names/slugs that already exist.
 */
export function planSets(
  projects: ProjectRow[],
  nonEmpty: EnvironmentRow[],
  takenNames: string[] = [],
  takenSlugs: string[] = [],
): PlannedSet[] {
  const names = [...takenNames];
  const slugs = [...takenSlugs];
  const out: PlannedSet[] = [];
  for (const p of projects) {
    const environmentIds = nonEmpty
      .filter((e) => e.project_id === p.id)
      .map((e) => e.id);
    if (environmentIds.length === 0) continue;
    const name = uniqueSetName(p.name, names);
    const slug = uniqueSetSlug(slugifySetName(name), slugs);
    names.push(name);
    slugs.push(slug);
    out.push({ projectId: p.id, name, slug, environmentIds });
  }
  return out;
}

/**
 * Decrypts, rewrites `${{project.` to `${{vars.` and re-encrypts; returns the
 * input unchanged when nothing needed rewriting (no new ciphertext).
 */
export function rewriteEncrypted(cipher: string, key: string): string {
  let text: string;
  try {
    text = decryptSecret(cipher, key);
  } catch {
    throw new Error(
      'Could not decrypt stored environment variables: ENCRYPTION_KEY differs from the one they were saved with',
    );
  }
  const next = rewriteProjectReferences(text);
  return next === text ? cipher : encryptSecret(next, key);
}

const REWRITE_SQL = (table: string, from: string, to: string) =>
  `UPDATE "${table}" SET "env" = regexp_replace("env", '\\$\\{\\{(\\s*)${from}\\.', '\${{\\1${to}.', 'g')
   WHERE "env" ~ '\\$\\{\\{\\s*${from}\\.'`;

/**
 * Up: the new tables exist, the old ones still do. Copies every non-empty
 * project environment (with its id, so history and links map one to one)
 * into one set per project, shared with that project only; copies its
 * history; links applications and stacks at position 0; rewrites
 * `${{project.` in application/stack env and in set texts (and their
 * history); maps API token environment names to `*` + `/<name>` scopes.
 * Re-runnable: every insert keeps ids and skips existing rows.
 */
export async function migrateEnvironmentsToSets(
  db: SqlRunner,
  encryptionKey: string | undefined,
): Promise<{ sets: number; environments: number; links: number }> {
  const projects = (await db.query(
    `SELECT "id", "name" FROM "projects" ORDER BY "created_at", "id"`,
  )) as ProjectRow[];
  const envs = (await db.query(
    `SELECT "id", "project_id", "name", "protected", "variables_encrypted",
            "keys", "secret_flags", "created_at", "updated_at"
     FROM "project_environments"
     WHERE "variables_encrypted" IS NOT NULL
       AND "id" NOT IN (SELECT "id" FROM "variable_set_environments")
     ORDER BY "created_at", "id"`,
  )) as Array<
    EnvironmentRow & {
      name: string;
      protected: boolean;
      variables_encrypted: string;
      keys: unknown;
      secret_flags: unknown;
      created_at: Date;
      updated_at: Date;
    }
  >;
  // `${{project.` can only be found by decrypting, so any stored content
  // needs the key (same condition as the ProjectEnvironments migration).
  if (envs.length > 0 && !encryptionKey) {
    throw new Error(
      'ENCRYPTION_KEY is required to move project environment variables into variable sets (references are rewritten); set it and run the migration again',
    );
  }
  const existing = (await db.query(
    `SELECT "name", "slug" FROM "variable_sets"`,
  )) as Array<{ name: string; slug: string }>;
  const plan = planSets(
    projects,
    envs,
    existing.map((s) => s.name),
    existing.map((s) => s.slug),
  );
  const byId = new Map(envs.map((e) => [e.id, e]));
  let environments = 0;
  for (const set of plan) {
    const rows = (await db.query(
      `INSERT INTO "variable_sets" ("name", "slug", "shared_with_all")
       VALUES ($1, $2, false) RETURNING "id"`,
      [set.name, set.slug],
    )) as Array<{ id: string }>;
    const setId = rows[0].id;
    await db.query(
      `INSERT INTO "variable_set_projects" ("variable_set_id", "project_id")
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [setId, set.projectId],
    );
    for (const envId of set.environmentIds) {
      const e = byId.get(envId)!;
      await db.query(
        `INSERT INTO "variable_set_environments"
           ("id", "variable_set_id", "name", "protected", "variables_encrypted",
            "keys", "secret_flags", "created_at", "updated_at")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          e.id,
          setId,
          e.name,
          e.protected,
          rewriteEncrypted(e.variables_encrypted, encryptionKey as string),
          JSON.stringify(e.keys ?? []),
          JSON.stringify(e.secret_flags ?? {}),
          e.created_at,
          e.updated_at,
        ],
      );
      environments++;
    }
  }

  const versions = (await db.query(
    `SELECT v."id", v."environment_id", v."variables_encrypted", v."secret_flags",
            v."author_id", v."author_email", v."via", v."action", v."detail",
            v."summary", v."created_at"
     FROM "project_environment_versions" v
     JOIN "variable_set_environments" e ON e."id" = v."environment_id"
     WHERE v."id" NOT IN (SELECT "id" FROM "variable_set_environment_versions")`,
  )) as Array<Record<string, unknown>>;
  for (const v of versions) {
    await db.query(
      `INSERT INTO "variable_set_environment_versions"
         ("id", "environment_id", "variables_encrypted", "secret_flags", "author_id",
          "author_email", "via", "action", "detail", "summary", "created_at")
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, $11)
       ON CONFLICT DO NOTHING`,
      [
        v.id,
        v.environment_id,
        typeof v.variables_encrypted === 'string'
          ? rewriteEncrypted(v.variables_encrypted, encryptionKey as string)
          : null,
        JSON.stringify(v.secret_flags ?? {}),
        v.author_id,
        v.author_email,
        v.via,
        v.action,
        v.detail,
        JSON.stringify(v.summary ?? {}),
        v.created_at,
      ],
    );
  }

  let links = 0;
  for (const [table, column] of [
    ['applications', 'application_id'],
    ['compose_apps', 'compose_app_id'],
  ] as const) {
    const res = (await db.query(
      `INSERT INTO "variable_set_links" ("environment_id", "${column}", "position")
       SELECT t."environment_id", t."id", 0
       FROM "${table}" t
       JOIN "variable_set_environments" e ON e."id" = t."environment_id"
       WHERE NOT EXISTS (
         SELECT 1 FROM "variable_set_links" l WHERE l."${column}" = t."id")
       RETURNING "id"`,
    )) as unknown[];
    links += Array.isArray(res) ? res.length : 0;
    await db.query(REWRITE_SQL(table, 'project', 'vars'));
  }

  const tokens = (await db.query(
    `SELECT "id", "environments" FROM "api_tokens" WHERE "environments" IS NOT NULL`,
  )) as Array<{ id: string; environments: unknown }>;
  for (const t of tokens) {
    const scopes = scopesFromEnvironmentNames(t.environments);
    // A token limited to names that cannot be expressed keeps a scope that
    // matches nothing rather than becoming unrestricted.
    await db.query(
      `UPDATE "api_tokens" SET "variable_scopes" = $1::jsonb WHERE "id" = $2`,
      [JSON.stringify(scopes ?? ['*/-']), t.id],
    );
  }
  return { sets: plan.length, environments, links };
}

/**
 * Down (best effort, documented data loss): sets shared with exactly one
 * project (and not with all) go back into that project's environments with
 * their history; every project gets development / staging / production
 * again; applications and stacks point to the environment of their first
 * link when it came back to their project, otherwise to production; token
 * scopes of the form `*` + `/<name>` become environment names again.
 * `${{vars.` in application/stack env goes back to `${{project.`; set texts
 * are not rewritten back (they stay `${{vars.`, which alpha.9 rejects on save).
 */
export async function restoreProjectEnvironments(db: SqlRunner): Promise<void> {
  await db.query(
    `INSERT INTO "project_environments"
       ("id", "project_id", "name", "protected", "variables_encrypted", "keys",
        "secret_flags", "created_at", "updated_at")
     SELECT e."id", vp."project_id", e."name", e."protected", e."variables_encrypted",
            e."keys", e."secret_flags", e."created_at", e."updated_at"
     FROM "variable_set_environments" e
     JOIN "variable_sets" s ON s."id" = e."variable_set_id" AND NOT s."shared_with_all"
     JOIN "variable_set_projects" vp ON vp."variable_set_id" = s."id"
     WHERE (SELECT count(*) FROM "variable_set_projects" x
            WHERE x."variable_set_id" = s."id") = 1
     ORDER BY e."created_at"
     ON CONFLICT DO NOTHING`,
  );
  await db.query(
    `INSERT INTO "project_environment_versions"
       ("id", "environment_id", "variables_encrypted", "secret_flags", "author_id",
        "author_email", "via", "action", "detail", "summary", "created_at")
     SELECT v."id", v."environment_id", v."variables_encrypted", v."secret_flags",
            v."author_id", v."author_email", v."via", v."action", v."detail",
            v."summary", v."created_at"
     FROM "variable_set_environment_versions" v
     JOIN "project_environments" e ON e."id" = v."environment_id"
     ON CONFLICT DO NOTHING`,
  );
  await db.query(
    `INSERT INTO "project_environments" ("project_id", "name", "protected")
     SELECT p."id", d."name", d."protected"
     FROM "projects" p
     CROSS JOIN (VALUES ('development', false), ('staging', false), ('production', true)) AS d("name", "protected")
     ON CONFLICT DO NOTHING`,
  );
  for (const [table, column] of [
    ['applications', 'application_id'],
    ['compose_apps', 'compose_app_id'],
  ] as const) {
    await db.query(
      `UPDATE "${table}" t SET "environment_id" = COALESCE(
         (SELECT e."id" FROM "variable_set_links" l
          JOIN "project_environments" e ON e."id" = l."environment_id"
          WHERE l."${column}" = t."id" AND e."project_id" = t."project_id"
          ORDER BY l."position" LIMIT 1),
         (SELECT e."id" FROM "project_environments" e
          WHERE e."project_id" = t."project_id" AND e."name" = 'production'))`,
    );
    await db.query(REWRITE_SQL(table, 'vars', 'project'));
  }
  const tokens = (await db.query(
    `SELECT "id", "variable_scopes" FROM "api_tokens" WHERE "variable_scopes" IS NOT NULL`,
  )) as Array<{ id: string; variable_scopes: unknown }>;
  for (const t of tokens) {
    const names = (Array.isArray(t.variable_scopes) ? t.variable_scopes : [])
      .filter((s): s is string => typeof s === 'string')
      .filter((s) => s.startsWith('*/') && /^[a-z0-9-]{1,32}$/.test(s.slice(2)))
      .map((s) => s.slice(2));
    // Scopes naming a set cannot be expressed; such a token is limited to a
    // name that matches nothing rather than becoming unrestricted.
    await db.query(
      `UPDATE "api_tokens" SET "environments" = $1::jsonb WHERE "id" = $2`,
      [JSON.stringify(names.length > 0 ? names : ['-']), t.id],
    );
  }
}
