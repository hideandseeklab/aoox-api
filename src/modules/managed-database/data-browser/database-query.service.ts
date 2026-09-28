import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { composeLabels, DockerService } from '../../docker/docker.service';
import { tarFiles } from '../../application/nixpacks-builder.service';
import { APP_NETWORK } from '../../proxy/proxy.service';
import { ENGINES, imageNameFor } from '../engines';
import { ManagedDatabase } from '../managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';
import {
  ColumnInfoDto,
  DeleteRowDto,
  QueryResultDto,
  RowActionResultDto,
  TableExportQueryDto,
  TableInfoDto,
  TableRowsDto,
  TableRowsQueryDto,
  UpdateRowDto,
} from './data-browser.dto';
import {
  assertIdentifier,
  assertRowTarget,
  hasMultipleStatements,
  isReadStatement,
  MAX_EXPORT_ROWS,
  MAX_ROWS,
  normalizeSql,
  quoteIdent,
  sqlLiteral,
  toCsv,
  withRowCap,
} from './query-guard';
import {
  parseMysqlBatch,
  parsePsqlCsv,
  PSQL_NULL,
  ResultSet,
} from './query-output';

/** Engine-side statement timeout and the hard cap on the helper container. */
const STATEMENT_TIMEOUT_MS = 15_000;
const CONTAINER_TIMEOUT_MS = 30_000;
/** Import/export move whole databases; give them room. */
const TRANSFER_TIMEOUT_MS = 30 * 60_000;
/** Uploaded SQL is held in memory (tar'd into the helper), so cap it. */
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;
/** Output beyond this is cut before parsing (a SELECT without LIMIT is capped anyway). */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const WRITE_ROLES = new Set(['owner', 'admin']);

/** Redis commands members may run; everything else needs owner/admin. */
const REDIS_READ_COMMANDS = new Set([
  'get',
  'mget',
  'hget',
  'hgetall',
  'hkeys',
  'hlen',
  'lrange',
  'llen',
  'lindex',
  'smembers',
  'scard',
  'sismember',
  'zrange',
  'zrangebyscore',
  'zcard',
  'zscore',
  'keys',
  'scan',
  'type',
  'ttl',
  'pttl',
  'exists',
  'strlen',
  'dbsize',
  'info',
  'ping',
  'object',
  'memory',
]);

/**
 * Runs SQL / Redis commands against a managed database from a one-off
 * container of the engine's own image (same pattern as backups: no client
 * drivers in the API, credentials only via env). Members get a read-only
 * session enforced by the engine; owner/admin may write.
 */
@Injectable()
export class DatabaseQueryService {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
  ) {}

  async listTables(
    db: ManagedDatabase,
    database?: string,
  ): Promise<TableInfoDto[]> {
    if (db.engine === 'redis' || db.engine === 'valkey') {
      const res = await this.redis(db, [
        'SCAN',
        '0',
        'COUNT',
        String(MAX_ROWS),
      ]);
      const [, keys] = res as [string, string[]];
      return keys
        .sort()
        .map((name) => ({ schema: null, name, estimatedRows: null }));
    }
    if (db.engine === 'mongodb') {
      const names = (await this.mongo(db, 'db.getCollectionNames()', {
        database,
      })) as string[];
      return names
        .sort()
        .map((name) => ({ schema: null, name, estimatedRows: null }));
    }
    const sql =
      db.engine === 'postgres'
        ? `SELECT n.nspname AS schema, c.relname AS name, c.reltuples::bigint AS estimate
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')
           ORDER BY 1, 2`
        : `SELECT NULL AS \`schema\`, table_name AS name, table_rows AS estimate
           FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
           ORDER BY table_name`;
    const { rows } = await this.sql(db, sql, { readOnly: true, database });
    return rows.map(([schema, name, estimate]) => ({
      schema: schema ?? null,
      name: name ?? '',
      estimatedRows:
        estimate === null || estimate === '-1' ? null : Number(estimate),
    }));
  }

  async tableRows(
    db: ManagedDatabase,
    table: string,
    q: TableRowsQueryDto,
  ): Promise<TableRowsDto> {
    const limit = q.limit ?? 50;
    if (db.engine === 'redis' || db.engine === 'valkey')
      return this.redisKey(db, table, limit, q.offset ?? 0);
    if (db.engine === 'mongodb') {
      const started = Date.now();
      const docs = await this.mongoFind(db, table, {
        filter: '{}',
        sort: q.orderBy ? { [q.orderBy]: q.dir === 'desc' ? -1 : 1 } : null,
        skip: q.offset ?? 0,
        limit: limit + 1,
        database: q.db,
      });
      const rs = mongoDocsToRows(docs.slice(0, limit));
      return {
        ...rs,
        hasMore: docs.length > limit,
        truncated: false,
        message: null,
        durationMs: Date.now() - started,
      };
    }
    const engine = db.engine === 'postgres' ? 'postgres' : 'mysql';
    const from = this.tableRef(table, q.schema, engine);
    const order = q.orderBy
      ? ` ORDER BY ${quoteIdent(assertIdentifier(q.orderBy, 'column'), engine)} ${q.dir === 'desc' ? 'DESC' : 'ASC'}`
      : '';
    const started = Date.now();
    const rs = await this.sql(
      db,
      `SELECT * FROM ${from}${order} LIMIT ${limit + 1} OFFSET ${q.offset ?? 0}`,
      { readOnly: true, database: q.db },
    );
    return {
      columns: rs.columns,
      rows: rs.rows.slice(0, limit),
      hasMore: rs.rows.length > limit,
      truncated: false,
      message: null,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Column structure for one table: name, type, nullability, default and
   * whether it belongs to the primary key — the same information a "table
   * structure" tab shows, and what `assertRowTarget` checks an edit against.
   */
  async columns(
    db: ManagedDatabase,
    table: string,
    opts: { schema?: string; database?: string } = {},
  ): Promise<ColumnInfoDto[]> {
    if (db.engine === 'redis' || db.engine === 'valkey') {
      throw new BadRequestException('Redis keys have no column structure');
    }
    if (db.engine === 'mongodb') {
      throw new BadRequestException(
        'MongoDB documents have no fixed column structure',
      );
    }
    const tableLit = sqlLiteral(assertIdentifier(table, 'table'), 'postgres');
    const sql =
      db.engine === 'postgres'
        ? `SELECT c.column_name, c.data_type, (c.is_nullable = 'YES') AS nullable, c.column_default,
             EXISTS (
               SELECT 1 FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
               WHERE tc.constraint_type = 'PRIMARY KEY'
                 AND tc.table_name = c.table_name
                 AND tc.table_schema = c.table_schema
                 AND kcu.column_name = c.column_name
             ) AS is_pk
           FROM information_schema.columns c
           WHERE c.table_name = ${tableLit}
             AND c.table_schema = ${sqlLiteral(opts.schema ?? 'public', 'postgres')}
           ORDER BY c.ordinal_position`
        : `SELECT column_name, data_type, (is_nullable = 'YES') AS nullable, column_default,
             (column_key = 'PRI') AS is_pk
           FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = ${tableLit}
           ORDER BY ordinal_position`;
    const { rows } = await this.sql(db, sql, {
      readOnly: true,
      database: opts.database,
    });
    if (rows.length === 0) {
      throw new BadRequestException(`Unknown table: ${table}`);
    }
    return rows.map(([name, dataType, nullable, defaultValue, isPk]) => ({
      name: name ?? '',
      dataType: dataType ?? '',
      nullable: nullable === 't' || nullable === '1',
      defaultValue: defaultValue ?? null,
      isPrimaryKey: isPk === 't' || isPk === '1',
    }));
  }

  /**
   * Updates exactly one row. The target is proven, not trusted: `where` must
   * be the whole primary key (see `assertRowTarget`), and the statement is
   * checked afterwards to have touched exactly one row.
   */
  async updateRow(
    db: ManagedDatabase,
    table: string,
    dto: UpdateRowDto,
  ): Promise<RowActionResultDto> {
    if (db.engine === 'redis' || db.engine === 'valkey') {
      throw new BadRequestException(
        'Redis has no rows to edit; use the command box',
      );
    }
    if (db.engine === 'mongodb') {
      throw new BadRequestException(
        'Editing documents isn’t supported yet; use the query box',
      );
    }
    if (Object.keys(dto.set).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    const engine = db.engine === 'postgres' ? 'postgres' : 'mysql';
    const columns = await this.columns(db, table, {
      schema: dto.schema,
      database: dto.db,
    });
    assertRowTarget(columns, dto.where, dto.set);
    const from = this.tableRef(table, dto.schema, engine);
    const setSql = Object.entries(dto.set)
      .map(([k, v]) => `${quoteIdent(k, engine)} = ${sqlLiteral(v, engine)}`)
      .join(', ');
    const whereSql = this.whereSql(dto.where, engine);
    const stmt = `UPDATE ${from} SET ${setSql} WHERE ${whereSql}${engine === 'mysql' ? ' LIMIT 1' : ''}`;
    const affected = await this.writeRowStatement(db, stmt, engine, dto.db);
    if (affected !== 1) {
      throw new BadRequestException(
        `Expected to update exactly one row, updated ${affected}`,
      );
    }
    return { message: 'Row updated' };
  }

  /** Deletes exactly one row, under the same primary-key guarantee as `updateRow`. */
  async deleteRow(
    db: ManagedDatabase,
    table: string,
    dto: DeleteRowDto,
  ): Promise<RowActionResultDto> {
    if (db.engine === 'redis' || db.engine === 'valkey') {
      throw new BadRequestException(
        'Redis has no rows to delete; use the command box',
      );
    }
    if (db.engine === 'mongodb') {
      throw new BadRequestException(
        'Deleting documents isn’t supported yet; use the query box',
      );
    }
    const engine = db.engine === 'postgres' ? 'postgres' : 'mysql';
    const columns = await this.columns(db, table, {
      schema: dto.schema,
      database: dto.db,
    });
    assertRowTarget(columns, dto.where);
    const from = this.tableRef(table, dto.schema, engine);
    const whereSql = this.whereSql(dto.where, engine);
    const stmt = `DELETE FROM ${from} WHERE ${whereSql}${engine === 'mysql' ? ' LIMIT 1' : ''}`;
    const affected = await this.writeRowStatement(db, stmt, engine, dto.db);
    if (affected !== 1) {
      throw new BadRequestException(
        `Expected to delete exactly one row, deleted ${affected}`,
      );
    }
    return { message: 'Row deleted' };
  }

  /**
   * Runs an UPDATE/DELETE and reports how many rows it touched. Postgres
   * says so in its own command tag (`UPDATE 1`); the mysql/mariadb CLI does
   * not in batch mode, so a `SELECT ROW_COUNT()` is appended in the same
   * session (same connection, same script) to read it back.
   */
  private async writeRowStatement(
    db: ManagedDatabase,
    statement: string,
    engine: 'postgres' | 'mysql',
    database?: string,
  ): Promise<number> {
    if (engine === 'postgres') {
      const rs = await this.sql(db, statement, { readOnly: false, database });
      const tag = rs.columns[0] ?? '';
      const m = /^(?:UPDATE|DELETE) (\d+)$/.exec(tag);
      return m ? Number(m[1]) : 0;
    }
    const rs = await this.sql(
      db,
      `${statement}; SELECT ROW_COUNT() AS affected`,
      {
        readOnly: false,
        database,
      },
    );
    const value = rs.rows[0]?.[0];
    return value ? Number(value) : 0;
  }

  /** `WHERE col = val AND col2 = val2` from an already-validated target. */
  private whereSql(
    where: Record<string, string | null>,
    engine: 'postgres' | 'mysql',
  ): string {
    return Object.entries(where)
      .map(([k, v]) => `${quoteIdent(k, engine)} = ${sqlLiteral(v, engine)}`)
      .join(' AND ');
  }

  /** `schema.table` (or just `table`), each part quoted and identifier-checked. */
  private tableRef(
    table: string,
    schema: string | undefined,
    engine: 'postgres' | 'mysql',
  ): string {
    const ident = (n: string, what: string) =>
      quoteIdent(assertIdentifier(n, what), engine);
    return schema
      ? `${ident(schema, 'schema')}.${ident(table, 'table')}`
      : ident(table, 'table');
  }

  /**
   * Table CSV, capped at MAX_EXPORT_ROWS (separate from the query cap: this
   * is a download of the table, not a bounded query result).
   */
  async exportTableCsv(
    db: ManagedDatabase,
    table: string,
    q: TableExportQueryDto,
  ): Promise<{ csv: string; truncated: boolean }> {
    if (db.engine === 'redis' || db.engine === 'valkey') {
      throw new BadRequestException(
        'Redis has no rows to export as CSV; use the command box',
      );
    }
    if (db.engine === 'mongodb') {
      const docs = await this.mongoFind(db, table, {
        filter: '{}',
        sort: q.orderBy ? { [q.orderBy]: q.dir === 'desc' ? -1 : 1 } : null,
        skip: 0,
        limit: MAX_EXPORT_ROWS + 1,
        database: q.db,
      });
      const truncated = docs.length > MAX_EXPORT_ROWS;
      const rs = mongoDocsToRows(docs.slice(0, MAX_EXPORT_ROWS));
      return { csv: toCsv(rs.columns, rs.rows), truncated };
    }
    const engine = db.engine === 'postgres' ? 'postgres' : 'mysql';
    const from = this.tableRef(table, q.schema, engine);
    const order = q.orderBy
      ? ` ORDER BY ${quoteIdent(assertIdentifier(q.orderBy, 'column'), engine)} ${q.dir === 'desc' ? 'DESC' : 'ASC'}`
      : '';
    const rs = await this.sql(
      db,
      `SELECT * FROM ${from}${order} LIMIT ${MAX_EXPORT_ROWS + 1}`,
      { readOnly: true, database: q.db },
    );
    const truncated = rs.rows.length > MAX_EXPORT_ROWS;
    const rows = rs.rows.slice(0, MAX_EXPORT_ROWS);
    return { csv: toCsv(rs.columns, rows), truncated };
  }

  async runQuery(
    db: ManagedDatabase,
    input: string,
    role: string,
    database?: string,
  ): Promise<QueryResultDto> {
    const started = Date.now();
    if (db.engine === 'redis' || db.engine === 'valkey') {
      const args = tokenize(input);
      if (args.length === 0) throw new BadRequestException('Empty command');
      const read = REDIS_READ_COMMANDS.has(args[0].toLowerCase());
      if (!read && !WRITE_ROLES.has(role)) {
        throw new ForbiddenException(
          'Only owners and admins can run write commands',
        );
      }
      const value = await this.redis(db, args);
      const rs = redisToRows(value);
      return {
        ...rs,
        rows: rs.rows.slice(0, MAX_ROWS),
        truncated: rs.rows.length > MAX_ROWS,
        message: rs.columns.length === 0 ? 'OK' : null,
        durationMs: Date.now() - started,
      };
    }
    if (db.engine === 'mongodb') {
      // Read-only for everyone in this first pass (see AGENTS.md "Belum"):
      // no insert/update/delete/aggregate via the query box yet, only
      // `<collection>.find(<filter json>)`, mongosh shell syntax.
      const m = /^(\w+)\.find\((.*)\)\s*$/s.exec(input.trim());
      if (!m) {
        throw new BadRequestException(
          'Only <collection>.find({...}) is supported for now',
        );
      }
      const [, collection, filterSrc] = m;
      const docs = await this.mongoFind(db, collection, {
        filter: filterSrc.trim() || '{}',
        sort: null,
        skip: 0,
        limit: MAX_ROWS + 1,
        database,
      });
      const rs = mongoDocsToRows(docs.slice(0, MAX_ROWS));
      return {
        ...rs,
        truncated: docs.length > MAX_ROWS,
        message: null,
        durationMs: Date.now() - started,
      };
    }
    const sql = normalizeSql(input);
    if (!sql) throw new BadRequestException('Empty statement');
    if (hasMultipleStatements(sql)) {
      throw new BadRequestException('Run one statement at a time');
    }
    const read = isReadStatement(sql);
    if (!read && !WRITE_ROLES.has(role)) {
      throw new ForbiddenException(
        'Only owners and admins can run statements that modify data',
      );
    }
    const engine = db.engine === 'postgres' ? 'postgres' : 'mysql';
    const rs = await this.sql(db, withRowCap(sql, engine), {
      // Owner/admin sessions stay writable even for a SELECT (e.g. SELECT nextval()).
      readOnly: !WRITE_ROLES.has(role),
      database,
    });
    // psql echoes a command tag ("UPDATE 3") as the only line for non-SELECTs.
    const tag =
      rs.rows.length === 0 &&
      rs.columns.length === 1 &&
      /^[A-Z]+( [A-Z]+)*( \d+)*$/.test(rs.columns[0]) // UPDATE 3, CREATE TABLE, INSERT 0 1
        ? rs.columns[0]
        : null;
    return {
      columns: tag ? [] : rs.columns,
      rows: tag ? [] : rs.rows.slice(0, MAX_ROWS),
      truncated: rs.rows.length > MAX_ROWS,
      message: tag ?? (rs.columns.length === 0 ? 'OK' : null),
      durationMs: Date.now() - started,
    };
  }

  /**
   * Plain-SQL dump of one database streamed to `sink` (pg_dump / mysqldump
   * without the gzip and the backup row — this is the "download the schema
   * and data" button, backups stay the recovery path).
   */
  async exportSql(
    db: ManagedDatabase,
    database: string | undefined,
    sink: NodeJS.WritableStream,
  ): Promise<void> {
    const script = this.dumpScript(db);
    const run = await this.spawn(
      db,
      script,
      database ? [`DB_NAME=${database}`] : [],
      undefined,
      TRANSFER_TIMEOUT_MS,
    );
    try {
      if (run.code !== 0) {
        throw new BadRequestException(
          cleanError(run.stderr) || `exit ${run.code}`,
        );
      }
      await new Promise<void>((resolve, reject) =>
        this.docker.engine.streamFileFromContainer(
          run.id,
          '/out/stdout',
          sink,
          (err) => (err ? reject(err) : resolve()),
        ),
      );
    } finally {
      await this.docker.engine
        .removeContainer(run.id, true)
        .catch(() => undefined);
    }
  }

  /**
   * Runs an uploaded SQL file against one database (psql -f / mysql <).
   * The file is placed in the helper with the archive API before start, so
   * it never touches the API's filesystem. Errors abort at the first failing
   * statement (ON_ERROR_STOP); what ran before stays — same as the CLIs.
   */
  async importSql(
    db: ManagedDatabase,
    database: string | undefined,
    sql: Buffer,
  ): Promise<{ message: string }> {
    if (db.engine === 'redis' || db.engine === 'valkey') {
      throw new BadRequestException('Redis has no SQL to import');
    }
    if (db.engine === 'mongodb') {
      throw new BadRequestException(
        'MongoDB has no SQL to import; use a backup restore instead',
      );
    }
    if (sql.length > IMPORT_MAX_BYTES) {
      throw new BadRequestException(
        `File larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB; use a backup restore instead`,
      );
    }
    const script =
      db.engine === 'postgres'
        ? `PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f /in/import.sql`
        : `${db.engine === 'mariadb' ? 'mariadb' : 'mysql'} -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" "$DB_NAME" < /in/import.sql`;
    const { code, stdout, stderr } = await this.runInEngine(
      db,
      script,
      database ? [`DB_NAME=${database}`] : [],
      {
        tar: tarFiles([['in/import.sql', sql.toString('utf8')]]),
        timeoutMs: TRANSFER_TIMEOUT_MS,
      },
    );
    if (code !== 0) {
      throw new BadRequestException(cleanError(stderr) || `exit ${code}`);
    }
    void stdout; // dumps echo results of their own set_config SELECTs — noise
    return {
      message: `Import selesai (${(sql.length / 1024).toFixed(0)} KB SQL)`,
    };
  }

  /** Plain `pg_dump` / `mysqldump` of `$DB_NAME` to stdout. */
  private dumpScript(db: ManagedDatabase): string {
    switch (db.engine) {
      case 'postgres':
        return 'PGPASSWORD="$DB_PASSWORD" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --no-owner --no-privileges --clean --if-exists "$DB_NAME"';
      case 'mysql':
        return 'mysqldump -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" --single-transaction --routines --add-drop-table "$DB_NAME"';
      case 'mariadb':
        return 'mariadb-dump -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" --single-transaction --routines --add-drop-table "$DB_NAME"';
      case 'redis':
      case 'valkey':
        throw new BadRequestException(
          `${db.engine === 'valkey' ? 'Valkey' : 'Redis'} has no SQL to export; use a backup`,
        );
      case 'mongodb':
        throw new BadRequestException(
          'MongoDB has no SQL to export; use a backup',
        );
    }
  }

  // ---- engines ------------------------------------------------------------

  /**
   * Runs one statement through psql/mysql; `readOnly` is enforced by the
   * session. `database` switches to another database on the same server
   * (defaults to the one created at provisioning).
   */
  async sql(
    db: ManagedDatabase,
    statement: string,
    opts: { readOnly: boolean; database?: string },
  ): Promise<ResultSet> {
    const isPg = db.engine === 'postgres';
    let script: string;
    if (isPg) {
      // Session settings via PGOPTIONS so no `SET` command tags land in the output.
      const pgOptions = [
        `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
        ...(opts.readOnly ? ['-c default_transaction_read_only=on'] : []),
      ].join(' ');
      script =
        `printf '%s' "$SQL" > /tmp/q.sql && PGPASSWORD="$DB_PASSWORD" PGOPTIONS=${shellQuote(pgOptions)} ` +
        `psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --csv -P null=${shellQuote(PSQL_NULL)} -v ON_ERROR_STOP=1 -f /tmp/q.sql`;
    } else {
      const timeout =
        db.engine === 'mariadb'
          ? `SET SESSION max_statement_time = ${STATEMENT_TIMEOUT_MS / 1000};`
          : `SET SESSION max_execution_time = ${STATEMENT_TIMEOUT_MS};`;
      const pre = `${timeout}${opts.readOnly ? ' SET SESSION TRANSACTION READ ONLY;' : ''}`;
      script =
        `{ printf '%s\\n' ${shellQuote(pre)}; printf '%s' "$SQL"; } > /tmp/q.sql && ` +
        // The mariadb image ships only the `mariadb` client (no `mysql` alias).
        `${db.engine === 'mariadb' ? 'mariadb' : 'mysql'} -h "$DB_HOST" -P "$DB_PORT" -u root -p"$DB_PASSWORD" "$DB_NAME" --batch --column-names < /tmp/q.sql`;
    }
    const { code, stdout, stderr } = await this.runInEngine(db, script, [
      `SQL=${statement}`,
      ...(opts.database ? [`DB_NAME=${opts.database}`] : []),
    ]);
    if (code !== 0)
      throw new BadRequestException(cleanError(stderr) || `exit ${code}`);
    return isPg ? parsePsqlCsv(stdout) : parseMysqlBatch(stdout);
  }

  /** Names of every database on the server (used by `SchemasService`, mirrors `SHOW DATABASES`/`pg_database`). */
  async mongoDatabaseNames(db: ManagedDatabase): Promise<string[]> {
    const result = await this.mongo(
      db,
      'db.adminCommand({listDatabases:1, nameOnly:true}).databases.map(d => d.name)',
    );
    if (!Array.isArray(result)) return [];
    return result.filter((n): n is string => typeof n === 'string');
  }

  /**
   * Mongo creates databases lazily (no `CREATE DATABASE`) — a database only
   * "exists" once it holds a collection, so make it show up immediately by
   * writing one placeholder collection with a single throwaway document.
   */
  async mongoCreateDatabase(db: ManagedDatabase, name: string): Promise<void> {
    await this.mongo(
      db,
      'db.getCollection("_aoox_init").insertOne({createdAt: new Date()})',
      { database: name },
    );
  }

  async mongoDropDatabase(db: ManagedDatabase, name: string): Promise<void> {
    await this.mongo(db, 'db.dropDatabase()', { database: name });
  }

  private async redis(db: ManagedDatabase, args: string[]): Promise<unknown> {
    const script =
      `redis-cli -h "$DB_HOST" -p "$DB_PORT" -a "$DB_PASSWORD" --no-auth-warning --json ` +
      args.map(shellQuote).join(' ');
    const { code, stdout, stderr } = await this.runInEngine(db, script, []);
    if (code !== 0)
      throw new BadRequestException(cleanError(stderr) || `exit ${code}`);
    const text = stdout.trim();
    // redis-cli prints errors as `error:"..."` on stdout with exit 0.
    const err = /^error:"(.*)"$/s.exec(text);
    if (err) throw new BadRequestException(err[1]);
    try {
      return JSON.parse(text || 'null') as unknown;
    } catch {
      return text;
    }
  }

  private async redisKey(
    db: ManagedDatabase,
    key: string,
    limit: number,
    offset: number,
  ): Promise<TableRowsDto> {
    const started = Date.now();
    const type = String(await this.redis(db, ['TYPE', key]));
    const end = String(offset + limit); // inclusive; fetch one extra for hasMore
    const cmd: Record<string, string[]> = {
      string: ['GET', key],
      hash: ['HGETALL', key],
      list: ['LRANGE', key, String(offset), end],
      set: ['SMEMBERS', key],
      zset: ['ZRANGE', key, String(offset), end, 'WITHSCORES'],
      none: ['TYPE', key],
    };
    const value = await this.redis(db, cmd[type] ?? ['TYPE', key]);
    let rs = redisToRows(value);
    if (type === 'hash' || type === 'set') {
      rs = { ...rs, rows: rs.rows.slice(offset, offset + limit + 1) };
    }
    return {
      columns: rs.columns,
      rows: rs.rows.slice(0, limit),
      hasMore: rs.rows.length > limit,
      truncated: false,
      message: type === 'none' ? 'Key does not exist' : `type: ${type}`,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Evaluates `expression` and JSON-parses its single-line output. Root
   * creds only exist in the `admin` database (`authSource=admin`);
   * `$DB_NAME`/etc. are the same env vars `spawn()` already sets from `db` —
   * `opts.database` (the `?db=` schema switch) overrides `$DB_NAME` for this
   * call only, same pattern as `sql()`.
   *
   * `expression` is wrapped in `EJSON.stringify(..., {relaxed: true})`
   * before being evaluated — mongosh's default REPL output for a plain
   * value is its shell-inspect format (`[ 'a', 'b' ]`, unquoted keys), which
   * is not valid JSON and would make every non-string result fail to parse
   * here. Wrapping centrally means every caller gets real JSON back
   * (`ObjectId`/`Date` become `{"$oid":"..."}`/ISO strings) without having
   * to remember to wrap it themselves.
   */
  private async mongo(
    db: ManagedDatabase,
    expression: string,
    opts: { database?: string } = {},
  ): Promise<unknown> {
    const evalScript = `EJSON.stringify((${expression}), {relaxed: true})`;
    const script =
      `mongosh "mongodb://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?authSource=admin" --quiet --eval ` +
      shellQuote(evalScript);
    const { code, stdout, stderr } = await this.runInEngine(
      db,
      script,
      opts.database ? [`DB_NAME=${opts.database}`] : [],
    );
    if (code !== 0)
      throw new BadRequestException(cleanError(stderr) || `exit ${code}`);
    const text = stdout.trim();
    try {
      return JSON.parse(text || 'null') as unknown;
    } catch {
      throw new BadRequestException(text || 'Could not parse mongosh output');
    }
  }

  /**
   * `db.<collection>.find(<filter>)[.sort()][.skip()][.limit()]`, rendered
   * with `EJSON.stringify(..., {relaxed: true})` so `ObjectId`/`Date` values
   * come back as `{"$oid": "..."}`/ISO strings instead of `[object Object]`
   * — the same extended-JSON shape MongoDB Compass/`mongoexport` use.
   * `filter` is caller-controlled JS source (not user SQL — it becomes the
   * argument to `.find(...)` inside a script we generate), but it still runs
   * inside the collection's own database with no special privileges beyond
   * the app user, same trust boundary as every other engine's query box.
   */
  private async mongoFind(
    db: ManagedDatabase,
    collection: string,
    opts: {
      /** Strict JSON only (see below) — `{}` for no filter. */
      filter: string;
      sort: Record<string, 1 | -1> | null;
      skip: number;
      limit: number;
      database?: string;
    },
  ): Promise<Record<string, unknown>[]> {
    const script = buildMongoFindScript(collection, opts);
    const result = await this.mongo(db, script, { database: opts.database });
    if (!Array.isArray(result)) {
      throw new BadRequestException('Expected a list of documents');
    }
    return result as Record<string, unknown>[];
  }

  /**
   * One-off container of the engine image; stdout/stderr land in files that
   * are read back through the archive API (logs would add timestamps and
   * mangle multi-line CSV values). Killed after CONTAINER_TIMEOUT_MS.
   */
  private async runInEngine(
    db: ManagedDatabase,
    script: string,
    extraEnv: string[],
    opts: { tar?: Buffer; timeoutMs?: number } = {},
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const run = await this.spawn(
      db,
      script,
      extraEnv,
      opts.tar,
      opts.timeoutMs,
    );
    try {
      const stdout = (
        await this.docker.engine.readFileFromContainer(run.id, '/out/stdout')
      )
        .subarray(0, MAX_OUTPUT_BYTES)
        .toString('utf8');
      return { code: run.code, stdout, stderr: run.stderr };
    } finally {
      await this.docker.engine
        .removeContainer(run.id, true)
        .catch(() => undefined);
    }
  }

  /**
   * Creates and runs the helper (optionally seeding `/in` from `tar`
   * first), waits for it (killed after `timeoutMs`) and returns its exit
   * code and stderr. The caller reads `/out/stdout` and removes it.
   */
  private async spawn(
    db: ManagedDatabase,
    script: string,
    extraEnv: string[],
    tar?: Buffer,
    timeoutMs = CONTAINER_TIMEOUT_MS,
  ): Promise<{ id: string; code: number; stderr: string }> {
    const spec = ENGINES[db.engine];
    const image = `${imageNameFor(db.engine, db.variant)}:${db.imageTag}`;
    const password = await this.databases.password(db);
    await this.docker.ensureImage(image);
    const id = await this.docker.engine.createContainer({
      Image: image,
      Entrypoint: [
        'sh',
        '-c',
        `mkdir -p /out; { ${script}; } > /out/stdout 2> /out/stderr; echo $? > /out/code`,
      ],
      Env: [
        `DB_HOST=${containerNameForDb(db)}`,
        `DB_PORT=${spec.port}`,
        `DB_USER=${db.username}`,
        `DB_PASSWORD=${password}`,
        `DB_NAME=${db.databaseName}`,
        ...extraEnv, // later entries win, so a DB_NAME override goes here
      ],
      Labels: {
        'aoox.component': 'query',
        ...composeLabels('query-helper'),
      },
      HostConfig: { NetworkMode: APP_NETWORK },
    });
    try {
      if (tar) await this.docker.engine.putArchive(id, '/', tar);
      await this.docker.engine.startContainer(id);
      const timer = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new ServiceUnavailableException('Query timed out')),
          timeoutMs,
        ).unref(),
      );
      await Promise.race([this.docker.engine.waitContainer(id), timer]);
      const read = async (name: string) =>
        (await this.docker.engine.readFileFromContainer(id, `/out/${name}`))
          .subarray(0, MAX_OUTPUT_BYTES)
          .toString('utf8');
      const [code, stderr] = await Promise.all([read('code'), read('stderr')]);
      return { id, code: Number(code.trim()), stderr };
    } catch (err) {
      await this.docker.engine.removeContainer(id, true).catch(() => undefined);
      throw err;
    }
  }
}

/** Single-quotes a string for `sh -c`. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Drops psql/mysql noise like `ERROR:  ` / `ERROR 1064 (42000) at line 2: `. */
function cleanError(stderr: string): string {
  return stderr
    .split('\n')
    .filter((l) => l.trim() && !/^psql:.*\/tmp\/q\.sql:\d+: NOTICE/.test(l))
    .map((l) => l.replace(/^psql:\/tmp\/q\.sql:\d+:\s*/, ''))
    .join('\n')
    .trim()
    .slice(0, 2000);
}

/** Splits `HSET user:1 name "Ann Lee"` into arguments, honouring quotes. */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input.trim()))) {
    out.push(
      m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]),
    );
  }
  return out;
}

/** Renders a redis-cli --json reply as a tabular result. */
export function redisToRows(value: unknown): ResultSet {
  const str = (v: unknown) =>
    v === null ? null : typeof v === 'string' ? v : JSON.stringify(v);
  if (Array.isArray(value)) {
    return {
      columns: ['#', 'value'],
      rows: value.map((v, i) => [String(i), str(v)]),
    };
  }
  if (value && typeof value === 'object') {
    return {
      columns: ['field', 'value'],
      rows: Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        str(v),
      ]),
    };
  }
  return { columns: ['value'], rows: [[str(value)]] };
}

/**
 * Renders a list of MongoDB documents (already `EJSON.stringify`d and
 * JSON-parsed back, so nested values are plain JS) as a tabular result:
 * columns = every key seen across the batch, in first-seen order with `_id`
 * pinned first; a document missing a given key gets `null` for that cell.
 * Nested objects/arrays are shown as their JSON text, same convention as
 * `redisToRows`.
 */
export function mongoDocsToRows(docs: Record<string, unknown>[]): ResultSet {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const key of Object.keys(doc)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  columns.sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : 0));
  const str = (v: unknown) =>
    v === undefined || v === null
      ? null
      : typeof v === 'string'
        ? v
        : JSON.stringify(v);
  return {
    columns,
    rows: docs.map((doc) => columns.map((c) => str(doc[c]))),
  };
}

/**
 * Builds the `mongosh --eval` script for `db.<collection>.find(<filter>)`,
 * validating the collection name and filter first. Pure so the injection
 * mitigation below can be unit-tested without a real mongosh.
 *
 * The filter is parsed as strict JSON, then re-serialized, before it's
 * embedded in the generated script — this is what stops a query-box filter
 * like `{}); db.dropDatabase(); ({` from escaping the `.find(...)` call and
 * running as arbitrary mongosh JS: only a JSON literal (already validated,
 * no function calls or statements) can survive `JSON.parse`, so what
 * actually reaches the shell is always inert data. `$`-prefixed operator
 * keys (`{"qty":{"$gt":2}}`) are plain JSON and pass through fine;
 * extended-JSON literals like `{"$oid":"..."}` for `_id` are not
 * interpreted specially in this first pass (see AGENTS.md "Belum") — they'd
 * just filter for a field literally named `$oid`, not error, so document
 * the limitation rather than silently doing the wrong thing.
 */
export function buildMongoFindScript(
  collection: string,
  opts: {
    /** Strict JSON only — `{}` for no filter. */
    filter: string;
    sort: Record<string, 1 | -1> | null;
    skip: number;
    limit: number;
  },
): string {
  if (!/^[A-Za-z0-9_.$-]{1,120}$/.test(collection)) {
    throw new BadRequestException('Invalid collection name');
  }
  let filter: unknown;
  try {
    filter = JSON.parse(opts.filter || '{}');
  } catch {
    throw new BadRequestException('Filter must be valid JSON');
  }
  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    throw new BadRequestException('Filter must be a JSON object');
  }
  const chain = [
    `db.getCollection(${JSON.stringify(collection)}).find(${JSON.stringify(filter)})`,
    opts.sort ? `.sort(${JSON.stringify(opts.sort)})` : '',
    `.skip(${opts.skip})`,
    `.limit(${opts.limit})`,
  ].join('');
  // `mongo()` wraps this expression in `EJSON.stringify(..., {relaxed: true})`
  // itself — returning the raw `.toArray()` call here (not pre-wrapped)
  // avoids double-encoding it into a JSON string containing JSON text.
  return `${chain}.toArray()`;
}
