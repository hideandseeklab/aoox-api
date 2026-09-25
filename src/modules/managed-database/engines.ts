import { DatabaseEngine } from './managed-database.entity';

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
};
