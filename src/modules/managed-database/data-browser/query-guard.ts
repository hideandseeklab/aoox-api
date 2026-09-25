import { BadRequestException } from '@nestjs/common';

/**
 * Static checks on user SQL before it reaches an engine. Members may only
 * read; the engine session is additionally put in read-only mode for them
 * (DatabaseQueryService), so this is the friendly error, not the fence.
 */
export const MAX_ROWS = 500;
/** Hard cap on a table CSV export (separate from MAX_ROWS: a download, not a query result). */
export const MAX_EXPORT_ROWS = 5000;

const READ_KEYWORDS = new Set([
  'select',
  'with',
  'show',
  'explain',
  'describe',
  'desc',
  'values',
  'table',
]);

/** Strips line (`--`) and block comments, surrounding whitespace and trailing `;`. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();
}

/** True when a `;` appears outside quotes: more than one statement. */
export function hasMultipleStatements(sql: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      if (c === quote) {
        if (sql[i + 1] === quote) i++;
        else quote = null;
      }
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === ';') return true;
  }
  return false;
}

export function isReadStatement(sql: string): boolean {
  const first =
    normalizeSql(sql)
      .split(/[\s(]+/)[0]
      ?.toLowerCase() ?? '';
  return READ_KEYWORDS.has(first);
}

/**
 * Caps a SELECT/WITH that has no LIMIT of its own by wrapping it. Other
 * statements are returned untouched; rows are truncated after parsing anyway.
 */
export function withRowCap(sql: string, engine: 'postgres' | 'mysql'): string {
  const s = normalizeSql(sql);
  const first = s.split(/[\s(]+/)[0]?.toLowerCase();
  if ((first !== 'select' && first !== 'with') || /\blimit\b/i.test(s)) {
    return s;
  }
  const alias = engine === 'postgres' ? '"_q"' : '`_q`';
  return `SELECT * FROM (${s}) AS ${alias} LIMIT ${MAX_ROWS + 1}`;
}

/** Only plain identifiers are accepted from the table-browser routes. */
export function assertIdentifier(name: string, what: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(name)) {
    throw new Error(`Invalid ${what}: ${name}`);
  }
  return name;
}

export function quoteIdent(name: string, engine: 'postgres' | 'mysql'): string {
  const tick = '`';
  return engine === 'postgres'
    ? `"${name.replace(/"/g, '""')}"`
    : tick + name.split(tick).join(tick + tick) + tick;
}

/** One column of a table, as reported by information_schema. */
export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

/**
 * Verifies a row edit/delete target against the table's real columns —
 * never against what the client claims. `where` must be *exactly* the
 * primary key (no more: a superset could still be a stale filter; no
 * less: a subset could match more than one row), so the statement built
 * from it can only ever touch the one row the user opened. Every `set`
 * key must be a column the table actually has, and none of them the
 * primary key itself (renaming a row's identity is not "editing a cell").
 * Returns the primary key column names for the caller to build the WHERE.
 */
export function assertRowTarget(
  columns: ColumnInfo[],
  where: Record<string, string | null>,
  set: Record<string, string | null> = {},
): string[] {
  const pk = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (pk.length === 0) {
    throw new BadRequestException(
      'This table has no primary key; edit it with SQL instead',
    );
  }
  const whereKeys = Object.keys(where);
  const whereSet = new Set(whereKeys);
  const isExactPk =
    whereKeys.length === pk.length && pk.every((k) => whereSet.has(k));
  if (!isExactPk) {
    throw new BadRequestException(
      `where must be exactly the primary key: ${pk.join(', ')}`,
    );
  }
  if (pk.some((k) => where[k] === null)) {
    throw new BadRequestException('Primary key value cannot be null');
  }
  const known = new Set(columns.map((c) => c.name));
  const pkSet = new Set(pk);
  for (const key of Object.keys(set)) {
    if (!known.has(key)) {
      throw new BadRequestException(`Unknown column: ${key}`);
    }
    if (pkSet.has(key)) {
      throw new BadRequestException(
        'Cannot change a primary key column from the row editor',
      );
    }
  }
  return pk;
}

/** A value needing quotes or escaping under RFC 4180 (comma, quote, or a line break). */
const CSV_NEEDS_QUOTING = /["\r\n,]/;

/** RFC 4180: wrap in quotes and double any embedded quote when the field needs it. */
export function csvEscape(value: string | null): string {
  if (value === null) return '';
  if (!CSV_NEEDS_QUOTING.test(value)) return value;
  return '"' + value.split('"').join('""') + '"';
}

const CRLF = '\r\n';

/** Renders a result set as CSV text (CRLF line endings, header included). */
export function toCsv(columns: string[], rows: (string | null)[][]): string {
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join(CRLF) + CRLF;
}

/**
 * SQL string literal for a value that came from our own code (a where/set
 * value already checked by `assertRowTarget`), not user-typed SQL text.
 */
export function sqlLiteral(
  value: string | null,
  engine: 'postgres' | 'mysql',
): string {
  if (value === null) return 'NULL';
  const singleEscaped = value.split("'").join("''");
  const escaped =
    engine === 'mysql' ? singleEscaped.split('\\').join('\\\\') : singleEscaped;
  return "'" + escaped + "'";
}
