import { Injectable } from '@nestjs/common';
import {
  DATABASE_FIELDS,
  isSecretValue,
  parseEnvLines,
  REFERENCE,
} from '../variable-set/env-text';
import { VariableSetEnvironmentService } from '../variable-set/variable-set-environment.service';
import {
  LinkOwnerKind,
  VariableSetLinkService,
} from '../variable-set/variable-set-link.service';
import { ENGINES } from '../managed-database/engines';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { SecretSourceError } from '../secret-source/infisical.client';
import { ENV_KEY_PATTERN } from '../secret-source/secret-selection';
import { SecretSourceService } from '../secret-source/secret-source.service';
import { Application } from './application.entity';

export { parseEnvLines };

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
  /**
   * Which kind of owner `app` is, to find its variable set links. Compose
   * stacks are passed in as an `Application`-shaped object, so they must say
   * so. Default `application`.
   */
  owner?: LinkOwnerKind;
  /**
   * Use these (set environment) ids, in this order, instead of the saved
   * links: validating a new link list, or an owner that is not saved yet.
   */
  environmentIds?: string[];
}

/** Secret values shorter than this are not registered for redaction (they would mangle ordinary log text). */
const MIN_REDACT_LENGTH = 6;

export class EnvReferenceError extends Error {}

/**
 * Builds a container's env from the app's linked variable set environments
 * plus its own, expanding references to `${{vars.KEY}}` and to managed
 * databases of the same project. Links merge in order: later links override
 * earlier ones on the same key, the app's own env always wins. Runs at container create so
 * a rotated password or new database is picked up on the next deploy
 * without a rebuild. Unknown references fail the deployment: an empty
 * DATABASE_URL would only surface as a confusing runtime error.
 *
 * With an external secret source (Infisical) the folder's secrets are fetched
 * here, per call and never cached or stored: priority is variable sets < source
 * secrets (when `secretSync`) < application env, and `${{secret.KEY}}` works in
 * set values and application env. Source values are literal (never expanded).
 */
@Injectable()
export class EnvResolverService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly secretSource: SecretSourceService,
    private readonly environments: VariableSetEnvironmentService,
    private readonly links: VariableSetLinkService,
  ) {}

  async resolve(
    app: Application,
    opts: ResolveOptions = {},
  ): Promise<ResolvedEnv> {
    // Linked variable set environments, merged in order (later wins); each
    // key keeps the secret flag of the layer its value comes from.
    const environmentIds =
      opts.environmentIds ??
      (await this.links.environmentIdsFor(opts.owner ?? 'application', app.id));
    const layers = await this.environments.layersFor(environmentIds);
    const vars = new Map<string, string>();
    const flags: Record<string, boolean> = {};
    const secrets = new Set<string>();
    for (const layer of layers) {
      for (const [k, v] of parseEnvLines(layer.text)) {
        vars.set(k, v);
        if (layer.flags[k] === undefined) delete flags[k];
        else flags[k] = layer.flags[k];
        // A secret flag always masks (any non-empty length); an explicit "not
        // secret" never does; unmarked keys use the length heuristic. Shadowed
        // values are registered too: harmless, and simpler to reason about.
        if (isSecretValue(k, v, layer.flags)) secrets.add(v);
      }
    }
    const appEnv = parseEnvLines(app.env);
    const dbCache = new Map<string, Record<DatabaseField, string>>();

    // ---- external secret source ----
    const sourceActive =
      opts.secretSource !== false &&
      !!app.secretConnectionId &&
      !!app.secretProjectId &&
      !!app.secretEnvironment;
    const refersToSecret = [...vars.values(), ...appEnv.map(([, v]) => v)].some(
      (v) => /\$\{\{\s*secret\./.test(v),
    );
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

    // Source secrets sit between the variable sets and application env; keys
    // that are not valid env names are skipped. `literal` = never expanded.
    const merged = new Map<string, string>(vars);
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
        if (scope === 'vars' && field === undefined) {
          const v = vars.get(name);
          if (v === undefined) {
            throw new EnvReferenceError(
              `${key}: ${whole} — no variable "${name}" in the linked variable sets`,
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
            `${key}: ${whole} — use \${{vars.KEY}}, \${{secret.KEY}} or \${{database.<slug>.(${DATABASE_FIELDS.join('|')})}}`,
          );
        }
      }
      resolved += value.slice(last);
      env.push(`${key}=${resolved}`);
      // A flagged variable can hold references (a database password, a source
      // secret): the expanded value is what reaches the container and the logs.
      if (
        flags[key] === true &&
        vars.has(key) &&
        !appEnv.some(([k]) => k === key) &&
        resolved.length > 0
      ) {
        secrets.add(resolved);
      }
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
