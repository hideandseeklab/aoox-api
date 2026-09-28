import { DatabaseEngine, PostgresVariant } from './managed-database.entity';

/**
 * Per-engine container recipe, following each official image's documented
 * environment variables (hub.docker.com/_/postgres, _/mysql, _/mariadb, _/redis).
 */
export interface EngineSpec {
  image: string;
  defaultTag: string;
  port: number;
  dataPath: string;
  /** Whether the engine has a logical database name. */
  hasDatabase: boolean;
  env(opts: { username: string; password: string; database: string }): string[];
  cmd?(opts: { password: string }): string[];
  url(opts: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  }): string;
}

const enc = encodeURIComponent;

export const ENGINES: Record<DatabaseEngine, EngineSpec> = {
  postgres: {
    image: 'postgres',
    defaultTag: '16-alpine',
    port: 5432,
    dataPath: '/var/lib/postgresql/data',
    hasDatabase: true,
    env: ({ username, password, database }) => [
      `POSTGRES_USER=${username}`,
      `POSTGRES_PASSWORD=${password}`,
      `POSTGRES_DB=${database}`,
    ],
    url: ({ host, port, username, password, database }) =>
      `postgresql://${enc(username)}:${enc(password)}@${host}:${port}/${database}`,
  },
  mysql: {
    image: 'mysql',
    defaultTag: '8',
    port: 3306,
    dataPath: '/var/lib/mysql',
    hasDatabase: true,
    env: ({ username, password, database }) => [
      `MYSQL_ROOT_PASSWORD=${password}`,
      `MYSQL_USER=${username}`,
      `MYSQL_PASSWORD=${password}`,
      `MYSQL_DATABASE=${database}`,
    ],
    url: ({ host, port, username, password, database }) =>
      `mysql://${enc(username)}:${enc(password)}@${host}:${port}/${database}`,
  },
  mariadb: {
    image: 'mariadb',
    defaultTag: '11',
    port: 3306,
    dataPath: '/var/lib/mysql',
    hasDatabase: true,
    env: ({ username, password, database }) => [
      `MARIADB_ROOT_PASSWORD=${password}`,
      `MARIADB_USER=${username}`,
      `MARIADB_PASSWORD=${password}`,
      `MARIADB_DATABASE=${database}`,
    ],
    url: ({ host, port, username, password, database }) =>
      `mysql://${enc(username)}:${enc(password)}@${host}:${port}/${database}`,
  },
  redis: {
    image: 'redis',
    defaultTag: '7-alpine',
    port: 6379,
    dataPath: '/data',
    hasDatabase: false,
    env: () => [],
    cmd: ({ password }) => [
      'redis-server',
      '--requirepass',
      password,
      '--appendonly',
      'yes',
    ],
    url: ({ host, port, password }) =>
      `redis://:${enc(password)}@${host}:${port}/0`,
  },
  /**
   * Drop-in Redis replacement (Linux Foundation fork). Ships both
   * `valkey-cli` and a `redis-cli` symlink (verified in the image), so the
   * entire backup/data-browser code path that shells out to `redis-cli`
   * works unmodified — every place that special-cases `engine === 'redis'`
   * also needs `'valkey'`.
   */
  valkey: {
    image: 'valkey/valkey',
    defaultTag: '8-alpine',
    port: 6379,
    dataPath: '/data',
    hasDatabase: false,
    env: () => [],
    cmd: ({ password }) => [
      'valkey-server',
      '--requirepass',
      password,
      '--appendonly',
      'yes',
    ],
    url: ({ host, port, password }) =>
      `redis://:${enc(password)}@${host}:${port}/0`,
  },
  /**
   * Root user created via the official image's env vars; every other
   * database on the server is created lazily (no `CREATE DATABASE`) — see
   * `ManagedDatabaseService`'s post-start init, which writes one placeholder
   * document so `databaseName` shows up in `schemas/` right away instead of
   * only after the app's first write.
   */
  mongodb: {
    image: 'mongo',
    defaultTag: '7',
    port: 27017,
    dataPath: '/data/db',
    hasDatabase: true,
    env: ({ username, password }) => [
      `MONGO_INITDB_ROOT_USERNAME=${username}`,
      `MONGO_INITDB_ROOT_PASSWORD=${password}`,
    ],
    // authSource=admin: the root user only exists in the `admin` database.
    url: ({ host, port, username, password, database }) =>
      `mongodb://${enc(username)}:${enc(password)}@${host}:${port}/${database}?authSource=admin`,
  },
};

/**
 * `postgres` variants: same wire protocol/env/URL as plain Postgres (they're
 * built on the official image), just a different image with an extension
 * preinstalled — activated once with `CREATE EXTENSION IF NOT EXISTS` after
 * the container is accepting connections. Tags verified to exist on Docker
 * Hub against the Postgres major this engine defaults to (16).
 */
export interface PostgresVariantSpec {
  image: string;
  /** Default tag for Postgres major 16 (matches `ENGINES.postgres.defaultTag`). */
  defaultTag: string;
  label: string;
  description: string;
  /** Run once after the container accepts connections; `IF NOT EXISTS` makes it idempotent. */
  extensionSql: string[];
}

export const POSTGRES_VARIANTS: Record<
  Exclude<PostgresVariant, null>,
  PostgresVariantSpec
> = {
  pgvector: {
    image: 'pgvector/pgvector',
    defaultTag: 'pg16',
    label: 'pgvector',
    description: 'Vector similarity search for embeddings (AI/ML workloads).',
    extensionSql: ['CREATE EXTENSION IF NOT EXISTS vector'],
  },
  postgis: {
    image: 'postgis/postgis',
    defaultTag: '16-3.4',
    label: 'PostGIS',
    description: 'Geographic/spatial data types, indexes and queries.',
    extensionSql: ['CREATE EXTENSION IF NOT EXISTS postgis'],
  },
  timescaledb: {
    image: 'timescale/timescaledb',
    defaultTag: 'latest-pg16',
    label: 'TimescaleDB',
    description: 'Time-series data: hypertables, continuous aggregates.',
    /**
     * Docs (docs.timescale.com/self-hosted/latest/upgrades/upgrade-docker/)
     * call for `ALTER EXTENSION timescaledb UPDATE` after a restore from a
     * dump taken on a different image build — not needed for our case since
     * backup/restore always targets the same running container (same image,
     * same extension version), never a version jump.
     */
    extensionSql: ['CREATE EXTENSION IF NOT EXISTS timescaledb'],
  },
};

/** Image (repo, no tag) for a database row: the variant's image for a variant Postgres, `ENGINES[engine].image` otherwise. */
export function imageNameFor(
  engine: DatabaseEngine,
  variant: PostgresVariant,
): string {
  if (engine === 'postgres' && variant) return POSTGRES_VARIANTS[variant].image;
  return ENGINES[engine].image;
}

/** Default tag for a database row, honoring the Postgres variant if set. */
export function defaultTagFor(
  engine: DatabaseEngine,
  variant: PostgresVariant,
): string {
  if (engine === 'postgres' && variant)
    return POSTGRES_VARIANTS[variant].defaultTag;
  return ENGINES[engine].defaultTag;
}
