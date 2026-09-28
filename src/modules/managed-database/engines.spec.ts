import {
  defaultTagFor,
  ENGINES,
  imageNameFor,
  POSTGRES_VARIANTS,
} from './engines';

describe('database engine recipes', () => {
  const opts = { username: 'app', password: 'p@ss/w', database: 'db1' };

  it('postgres uses the official env vars and a postgresql:// url with escaping', () => {
    expect(ENGINES.postgres.env(opts)).toEqual([
      'POSTGRES_USER=app',
      'POSTGRES_PASSWORD=p@ss/w',
      'POSTGRES_DB=db1',
    ]);
    expect(ENGINES.postgres.url({ ...opts, host: 'h', port: 5432 })).toBe(
      'postgresql://app:p%40ss%2Fw@h:5432/db1',
    );
  });

  it('mysql and mariadb set root + app user', () => {
    expect(ENGINES.mysql.env(opts)).toContain('MYSQL_ROOT_PASSWORD=p@ss/w');
    expect(ENGINES.mysql.env(opts)).toContain('MYSQL_USER=app');
    expect(ENGINES.mariadb.env(opts)).toContain('MARIADB_DATABASE=db1');
    expect(ENGINES.mariadb.url({ ...opts, host: 'h', port: 3306 })).toMatch(
      /^mysql:\/\//,
    );
  });

  it('redis requires a password via the command line and has no database name', () => {
    expect(ENGINES.redis.hasDatabase).toBe(false);
    expect(ENGINES.redis.cmd?.({ password: 'secret' })).toEqual([
      'redis-server',
      '--requirepass',
      'secret',
      '--appendonly',
      'yes',
    ]);
    expect(
      ENGINES.redis.url({ ...opts, password: 'secret', host: 'h', port: 6379 }),
    ).toBe('redis://:secret@h:6379/0');
  });

  it('valkey is a redis drop-in: same requirepass command line, same redis:// url', () => {
    expect(ENGINES.valkey.hasDatabase).toBe(false);
    expect(ENGINES.valkey.cmd?.({ password: 'secret' })).toEqual([
      'valkey-server',
      '--requirepass',
      'secret',
      '--appendonly',
      'yes',
    ]);
    expect(
      ENGINES.valkey.url({
        ...opts,
        password: 'secret',
        host: 'h',
        port: 6379,
      }),
    ).toBe('redis://:secret@h:6379/0');
  });

  it('imageNameFor/defaultTagFor pick the variant image and tag for postgres variants', () => {
    expect(imageNameFor('postgres', null)).toBe('postgres');
    expect(imageNameFor('postgres', 'pgvector')).toBe('pgvector/pgvector');
    expect(imageNameFor('postgres', 'postgis')).toBe('postgis/postgis');
    expect(imageNameFor('postgres', 'timescaledb')).toBe(
      'timescale/timescaledb',
    );
    expect(imageNameFor('redis', null)).toBe('redis');
    expect(imageNameFor('valkey', null)).toBe('valkey/valkey');

    expect(defaultTagFor('postgres', null)).toBe(ENGINES.postgres.defaultTag);
    expect(defaultTagFor('postgres', 'pgvector')).toBe(
      POSTGRES_VARIANTS.pgvector.defaultTag,
    );
  });

  it('every postgres variant has at least one CREATE EXTENSION statement', () => {
    for (const variant of Object.values(POSTGRES_VARIANTS)) {
      expect(variant.extensionSql.length).toBeGreaterThan(0);
      for (const stmt of variant.extensionSql) {
        expect(stmt).toMatch(/^CREATE EXTENSION IF NOT EXISTS /);
      }
    }
  });
});
