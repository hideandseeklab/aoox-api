import { Injectable } from '@nestjs/common';
import { ENGINES } from '../managed-database/engines';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { SecretSourceError } from '../secret-source/infisical.client';
import { ENV_KEY_PATTERN } from '../secret-source/secret-selection';
import { SecretSourceService } from '../secret-source/secret-source.service';
import { Application } from './application.entity';

/** Parsed `KEY=VALUE` lines; blank lines and `#` comments are ignored. */
export function parseEnvLines(
  text: string,
): Array<[key: string, value: string]> {
  const out: Array<[string, string]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out.push([line.slice(0, eq).trim(), line.slice(eq + 1)]);
  }
  return out;
}

/**
 * `${{project.KEY}}`, `${{secret.KEY}}` (external secret source),
 * `${{database.<slug>.<field>}}`, or `${{database.<slug>.<field>:<name>}}`
 * for another database on the same server.
 */
const REFERENCE =
  /\$\{\{\s*([a-z]+)\.([A-Za-z0-9_-]+)(?:\.([a-z]+))?(?::([A-Za-z0-9_$-]+))?\s*\}\}/g;

const DATABASE_FIELDS = [
  'url',
  'host',
  'port',
  'username',
  'password',
  'database',
] as const;
type DatabaseField = (typeof DATABASE_FIELDS)[number];

export interface ResolvedEnv {
  /** `KEY=VALUE` entries for the container. */
  env: string[];
  /** Values that must never appear in logs (database passwords, secret-source values). */
  secrets: string[];
}

export interface ResolveOptions {
  /**
   * `false` ignores the application's secret source. Pull-request previews
   * pass it: a PR branch is arbitrary code and must not receive the secrets
   * of the real deployment (same rule as mounts).
   */
  secretSource?: boolean;
  /**
   * Validation only (saving env): an unreachable source is not an error and
   * `${{secret.KEY}}` references are not checked — a flaky secret manager
   * must not block editing. Real container creation never sets this.
   */
  lenient?: boolean;
}

/** Secret values shorter than this are not registered for redaction (they would mangle ordinary log text). */
const MIN_REDACT_LENGTH = 6;

export class EnvReferenceError extends Error {}

/**
 * Builds a container's env from the project's shared env plus the app's own
 * (the app wins on duplicate keys), expanding references to project vars
 * and to managed databases of the same project. Runs at container create so
 * a rotated password or new database is picked up on the next deploy
 * without a rebuild. Unknown references fail the deployment: an empty
 * DATABASE_URL would only surface as a confusing runtime error.
 *
 * With an external secret source (Infisical) the folder's secrets are fetched
 * here, per call and never cached or stored: priority is project env < source
 * secrets (when `secretSync`) < application env, and `${{secret.KEY}}` works in
 * project and application env. Source values are literal (never expanded).
 */
@Injectable()
export class EnvResolverService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly secretSource: SecretSourceService,
  ) {}

  async resolve(
    app: Application,
    opts: ResolveOptions = {},
  ): Promise<ResolvedEnv> {
    const project = new Map(parseEnvLines(app.project.env ?? ''));
    const appEnv = parseEnvLines(app.env);
    const secrets = new Set<string>();
    const dbCache = new Map<string, Record<DatabaseField, string>>();

    // ---- external secret source ----
    const sourceActive =
      opts.secretSource !== false &&
      !!app.secretConnectionId &&
      !!app.secretProjectId &&
      !!app.secretEnvironment;
    const refersToSecret = [
      ...project.values(),
      ...appEnv.map(([, v]) => v),
    ].some((v) => /\$\{\{\s*secret\./.test(v));
    let fetched: Map<string, string> | null = null;
    if (sourceActive && (app.secretSync || refersToSecret)) {
      try {
        fetched = await this.secretSource.fetch(app.secretConnectionId!, {
          projectId: app.secretProjectId!,
          environment: app.secretEnvironment!,
          path: app.secretPath || '/',
        });
      } catch (err) {
        if (!(opts.lenient && err instanceof SecretSourceError)) throw err;
      }
      for (const v of fetched?.values() ?? []) {
        if (v.length >= MIN_REDACT_LENGTH) secrets.add(v);
      }
    }

    // Source secrets sit between project and application env; keys that are
    // not valid env names are skipped. `literal` = never expanded.
    const merged = new Map<string, string>(project);
    const literal = new Set<string>();
    if (fetched && app.secretSync) {
      for (const [k, v] of fetched) {
        if (!ENV_KEY_PATTERN.test(k)) continue;
        merged.set(k, v);
        literal.add(k);
      }
    }
    for (const [k, v] of appEnv) {
      merged.set(k, v);
      literal.delete(k);
    }

    const env: string[] = [];
    for (const [key, value] of merged) {
      if (literal.has(key)) {
        env.push(`${key}=${value}`);
        continue;
      }
      let resolved = '';
      let last = 0;
      for (const m of value.matchAll(REFERENCE)) {
        const [whole, scope, name, field, dbName] = m;
        resolved += value.slice(last, m.index);
        last = m.index + whole.length;
        if (scope === 'project' && field === undefined) {
          const v = project.get(name);
          if (v === undefined) {
            throw new EnvReferenceError(
              `${key}: ${whole} — no shared variable "${name}" in the project`,
            );
          }
          resolved += v;
        } else if (scope === 'secret' && field === undefined) {
          if (!sourceActive) {
            throw new EnvReferenceError(
              `${key}: ${whole} — ` +
                (app.secretConnectionId
                  ? 'secret sources are not available in pull-request previews'
                  : 'this application has no secret source (Environment tab)'),
            );
          }
          if (fetched === null) {
            // Only reachable in lenient (validation) mode: not checked.
            continue;
          }
          const v = fetched.get(name);
          if (v === undefined) {
            throw new EnvReferenceError(
              `${key}: ${whole} — no secret "${name}" at ${app.secretPath || '/'} (${app.secretEnvironment}) in the secret source`,
            );
          }
          resolved += v;
        } else if (scope === 'database' && isDatabaseField(field)) {
          const cacheKey = dbName ? `${name}:${dbName}` : name;
          let fields = dbCache.get(cacheKey);
          if (!fields) {
            fields = await this.databaseFields(
              app.projectId,
              name,
              key,
              whole,
              dbName,
            );
            dbCache.set(cacheKey, fields);
            secrets.add(fields.password);
          }
          resolved += fields[field];
        } else {
          throw new EnvReferenceError(
            `${key}: ${whole} — use \${{project.KEY}}, \${{secret.KEY}} or \${{database.<slug>.(${DATABASE_FIELDS.join('|')})}}`,
          );
        }
      }
      resolved += value.slice(last);
      env.push(`${key}=${resolved}`);
    }
    return { env, secrets: [...secrets] };
  }

  /** Databases are looked up within the app's project only (slugs are global). */
  private async databaseFields(
    projectId: string,
    slug: string,
    key: string,
    whole: string,
    dbName?: string,
  ): Promise<Record<DatabaseField, string>> {
    const db = await this.databases.repo.findOne({
      where: { projectId, slug },
    });
    if (!db) {
      throw new EnvReferenceError(
        `${key}: ${whole} — no database "${slug}" in this project`,
      );
    }
    const c = await this.databases.connection(db);
    // `:name` = another database on the same server (created via schemas/);
    // same host/user/password, only the database part of the URL changes.
    const database = dbName ?? c.database;
    return {
      url: dbName
        ? ENGINES[db.engine].url({
            host: c.internalHost,
            port: c.internalPort,
            username: c.username,
            password: c.password,
            database,
          })
        : c.internalUrl,
      host: c.internalHost,
      port: String(c.internalPort),
      username: c.username,
      password: c.password,
      database,
    };
  }
}

function isDatabaseField(f: string | undefined): f is DatabaseField {
  return (DATABASE_FIELDS as readonly string[]).includes(f ?? '');
}
