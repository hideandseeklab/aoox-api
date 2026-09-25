import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseQueryService } from '../data-browser/database-query.service';
import { quoteIdent } from '../data-browser/query-guard';
import { ManagedDatabase } from '../managed-database.entity';
import { SchemaInfoDto } from './schemas.dto';

/** Engine-owned databases that must never be listed, dropped or dumped. */
export const SYSTEM_SCHEMAS: Record<'postgres' | 'mysql', string[]> = {
  postgres: ['postgres', 'template0', 'template1'],
  mysql: ['information_schema', 'performance_schema', 'mysql', 'sys'],
};

/**
 * One managed server can hold many databases (Postgres) / schemas (MySQL,
 * MariaDB). aoox creates one at provisioning; this adds the rest,
 * always granting the application user so the connection string works
 * with just the database name swapped. Redis has numbered DBs, not names —
 * not supported here.
 */
@Injectable()
export class SchemasService {
  constructor(private readonly queries: DatabaseQueryService) {}

  async list(db: ManagedDatabase): Promise<SchemaInfoDto[]> {
    const engine = this.engineOf(db);
    const sql =
      engine === 'postgres'
        ? `SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1`
        : `SHOW DATABASES`;
    const { rows } = await this.queries.sql(db, sql, { readOnly: true });
    return rows
      .map((r) => r[0] ?? '')
      .filter((n) => n && !SYSTEM_SCHEMAS[engine].includes(n))
      .map((name) => ({ name, isPrimary: name === db.databaseName }));
  }

  async create(db: ManagedDatabase, name: string): Promise<SchemaInfoDto> {
    const engine = this.engineOf(db);
    if (SYSTEM_SCHEMAS[engine].includes(name)) {
      throw new BadRequestException(`${name} is reserved by the engine`);
    }
    const ident = quoteIdent(name, engine);
    if (engine === 'postgres') {
      // The provisioning user (POSTGRES_USER) is a superuser; owning the new
      // database gives it full rights without a separate GRANT.
      await this.queries.sql(
        db,
        `CREATE DATABASE ${ident} OWNER ${quoteIdent(db.username, 'postgres')}`,
        { readOnly: false },
      );
    } else {
      await this.queries.sql(db, `CREATE DATABASE ${ident}`, {
        readOnly: false,
      });
      await this.queries.sql(
        db,
        `GRANT ALL PRIVILEGES ON ${ident}.* TO ${mysqlUser(db.username)}`,
        { readOnly: false },
      );
    }
    return { name, isPrimary: false };
  }

  async drop(db: ManagedDatabase, name: string): Promise<void> {
    const engine = this.engineOf(db);
    if (name === db.databaseName) {
      throw new BadRequestException(
        'The primary database cannot be dropped; delete the managed database instead',
      );
    }
    if (SYSTEM_SCHEMAS[engine].includes(name)) {
      throw new BadRequestException(`${name} is reserved by the engine`);
    }
    const ident = quoteIdent(name, engine);
    await this.queries.sql(
      db,
      engine === 'postgres'
        ? // FORCE (PG 13+) closes the app's open connections instead of failing.
          `DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`
        : `DROP DATABASE IF EXISTS ${ident}`,
      { readOnly: false },
    );
  }

  private engineOf(db: ManagedDatabase): 'postgres' | 'mysql' {
    if (db.engine === 'redis') {
      throw new BadRequestException(
        'Redis has numbered databases (0–15), not named ones',
      );
    }
    return db.engine === 'postgres' ? 'postgres' : 'mysql';
  }
}

/** `'user'@'%'` with the name escaped for a MySQL string literal. */
function mysqlUser(username: string): string {
  return `'${username.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'@'%'`;
}
