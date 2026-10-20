import { BadRequestException } from '@nestjs/common';
import { assertMountPathAllowed, mountPathConflict } from './mount-path';

describe('mountPathConflict', () => {
  it.each([
    ['postgres', '/var/lib/postgresql/data'],
    ['postgres', '/var/lib/postgresql/data/pgdata'],
    ['postgres', '/var/lib/postgresql'],
    ['postgres', '/var/lib/postgresql/18/docker'],
    ['postgres', '/var/lib'],
    ['postgres', '/var'],
    ['postgres', '/'],
    ['mysql', '/var/lib/mysql'],
    ['mariadb', '/var/lib/mysql/mysql'],
    ['redis', '/data'],
    ['valkey', '/data/sub'],
    ['mongodb', '/data/db'],
    ['mongodb', '/data'],
  ] as const)('rejects %s %s', (engine, path) => {
    expect(mountPathConflict(engine, path)).not.toBeNull();
  });

  it.each([
    ['postgres', '/etc/postgresql/postgresql.conf'],
    ['postgres', '/var/lib/postgresql-extra'],
    ['postgres', '/var/lib/other'],
    ['mysql', '/etc/mysql/conf.d/my.cnf'],
    ['mysql', '/var/lib/mysql-files'],
    ['redis', '/usr/local/etc/redis/redis.conf'],
    ['redis', '/database'],
    ['mongodb', '/data/configdb'],
    ['mongodb', '/etc/mongod.conf'],
  ] as const)('allows %s %s', (engine, path) => {
    expect(mountPathConflict(engine, path)).toBeNull();
  });

  it('throws 400', () => {
    expect(() => assertMountPathAllowed('redis', '/data')).toThrow(
      BadRequestException,
    );
    expect(() => assertMountPathAllowed('redis', '/etc/r.conf')).not.toThrow();
  });
});

describe('mountPathConflict message', () => {
  it('names the data directory the database really uses (PostgreSQL 18)', () => {
    const msg = mountPathConflict(
      'postgres',
      '/var/lib/postgresql/data',
      '/var/lib/postgresql',
    );
    expect(msg).toContain('(/var/lib/postgresql)');
    expect(msg).not.toContain('postgresql/data)');
  });

  it('names the legacy path for a database that uses it', () => {
    expect(
      mountPathConflict(
        'postgres',
        '/var/lib/postgresql',
        '/var/lib/postgresql/data',
      ),
    ).toContain('(/var/lib/postgresql/data)');
  });

  it('lists every refused root when the real path is unknown', () => {
    const msg = mountPathConflict('postgres', '/var/lib/postgresql/data');
    expect(msg).toContain('/var/lib/postgresql/data or /var/lib/postgresql');
  });

  it('single-root engines are unchanged', () => {
    expect(mountPathConflict('redis', '/data')).toContain('(/data)');
  });

  it('the rule itself still refuses both PostgreSQL roots', () => {
    expect(
      mountPathConflict(
        'postgres',
        '/var/lib/postgresql/data',
        '/var/lib/postgresql',
      ),
    ).not.toBeNull();
    expect(
      mountPathConflict(
        'postgres',
        '/var/lib/postgresql',
        '/var/lib/postgresql',
      ),
    ).not.toBeNull();
  });
});
