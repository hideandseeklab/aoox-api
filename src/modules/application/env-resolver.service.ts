import { Injectable } from '@nestjs/common';
import { ENGINES } from '../managed-database/engines';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
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
 * `${{project.KEY}}`, `${{database.<slug>.<field>}}`, or
 * `${{database.<slug>.<field>:<name>}}` for another database on the same server.
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
  /** Values that must never appear in logs (resolved database passwords). */
  secrets: string[];
}

export class EnvReferenceError extends Error {}

/**
 * Builds a container's env from the project's shared env plus the app's own
 * (the app wins on duplicate keys), expanding references to project vars
 * and to managed databases of the same project. Runs at container create so
 * a rotated password or new database is picked up on the next deploy
 * without a rebuild. Unknown references fail the deployment: an empty
 * DATABASE_URL would only surface as a confusing runtime error.
 */
@Injectable()
export class EnvResolverService {
  constructor(private readonly databases: ManagedDatabaseService) {}

  async resolve(app: Application): Promise<ResolvedEnv> {
    const project = new Map(parseEnvLines(app.project.env ?? ''));
    const merged = new Map([...project, ...parseEnvLines(app.env)]);
    const secrets = new Set<string>();
    const dbCache = new Map<string, Record<DatabaseField, string>>();

    const env: string[] = [];
    for (const [key, value] of merged) {
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
            `${key}: ${whole} — use \${{project.KEY}} or \${{database.<slug>.(${DATABASE_FIELDS.join('|')})}}`,
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
