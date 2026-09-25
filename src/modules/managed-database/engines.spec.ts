import { ENGINES } from './engines';

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
});
