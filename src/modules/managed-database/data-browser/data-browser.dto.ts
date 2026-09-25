import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

export class TableInfoDto {
  /** Schema for Postgres (`public`), null for MySQL/MariaDB and Redis. */
  schema: string | null;
  name: string;
  /** Planner estimate (Postgres `reltuples`, MySQL `table_rows`); null when unknown. */
  estimatedRows: number | null;
  /** Redis only: key type. */
  type?: string;
}

/** `?db=` — another database on the same server (see schemas/). */
export class DatabaseSelectDto {
  @IsOptional()
  @IsString()
  @Matches(IDENT)
  db?: string;
}

export class TableRowsQueryDto extends DatabaseSelectDto {
  @IsOptional()
  @IsString()
  @Matches(IDENT)
  schema?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  @Matches(IDENT)
  orderBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}

export class TableRowsParamsDto {
  @IsUUID()
  id: string;

  /** Table name, or the Redis key. */
  @IsString()
  @MaxLength(512)
  table: string;
}

export class RunQueryDto {
  /** One SQL statement, or one Redis command (`HGETALL user:1`). */
  @IsString()
  @MaxLength(20_000)
  sql: string;

  @IsOptional()
  @IsString()
  @Matches(IDENT)
  db?: string;
}

export class QueryResultDto {
  columns: string[];
  rows: (string | null)[][];
  /** More rows existed than were returned (MAX_ROWS). */
  truncated: boolean;
  /** Command tag for statements without a result set (`UPDATE 3`, `OK`). */
  message: string | null;
  durationMs: number;
}

export class TableRowsDto extends QueryResultDto {
  hasMore: boolean;
}

export class ColumnInfoDto {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

/** Export params for a whole table: same filters as `rows`, no paging. */
export class TableExportQueryDto extends DatabaseSelectDto {
  @IsOptional()
  @IsString()
  @Matches(IDENT)
  schema?: string;

  @IsOptional()
  @IsString()
  @Matches(IDENT)
  orderBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}

/**
 * Row target + new values. Column names inside `where`/`set` are validated
 * against the table's real columns in the service (`assertRowTarget`), not
 * here — the DTO only enforces the shape (plain string/null values).
 */
export class UpdateRowDto extends DatabaseSelectDto {
  @IsOptional()
  @IsString()
  @Matches(IDENT)
  schema?: string;

  @IsObject()
  where: Record<string, string | null>;

  @IsObject()
  set: Record<string, string | null>;
}

export class DeleteRowDto extends DatabaseSelectDto {
  @IsOptional()
  @IsString()
  @Matches(IDENT)
  schema?: string;

  @IsObject()
  where: Record<string, string | null>;
}

export class RowActionResultDto {
  message: string;
}

export class QueryHistoryEntryDto {
  id: string;
  db: string | null;
  sql: string;
  success: boolean;
  errorMessage: string | null;
  rowCount: number | null;
  durationMs: number;
  createdAt: Date;
}
