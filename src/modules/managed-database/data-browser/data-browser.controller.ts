import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { ManagedDatabaseService } from '../managed-database.service';
import { QueryHistoryService } from '../query-history/query-history.service';
import {
  ColumnInfoDto,
  DatabaseSelectDto,
  DeleteRowDto,
  QueryResultDto,
  RowActionResultDto,
  RunQueryDto,
  TableExportQueryDto,
  TableInfoDto,
  TableRowsDto,
  TableRowsParamsDto,
  TableRowsQueryDto,
  UpdateRowDto,
} from './data-browser.dto';
import {
  DatabaseQueryService,
  IMPORT_MAX_BYTES,
} from './database-query.service';

/**
 * Minimal data browser (phpMyAdmin-lite): tables, paged rows, one query.
 * Each call starts a helper container, hence the throttle.
 */
@Controller('databases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class DataBrowserController {
  private readonly logger = new Logger(DataBrowserController.name);

  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly queries: DatabaseQueryService,
    private readonly history: QueryHistoryService,
  ) {}

  @Get(':id/tables')
  async tables(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Query() query: DatabaseSelectDto,
  ): Promise<TableInfoDto[]> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.queries.listTables(db, query.db);
  }

  @Get(':id/tables/:table/columns')
  async columns(
    @CurrentUser() user: JwtPayload,
    @Param() params: TableRowsParamsDto,
    @Query() query: TableRowsQueryDto,
  ): Promise<ColumnInfoDto[]> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.queries.columns(db, params.table, {
      schema: query.schema,
      database: query.db,
    });
  }

  @Get(':id/tables/:table/rows')
  async rows(
    @CurrentUser() user: JwtPayload,
    @Param() params: TableRowsParamsDto,
    @Query() query: TableRowsQueryDto,
  ): Promise<TableRowsDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.queries.tableRows(db, params.table, query);
  }

  /** CSV of a whole table (up to MAX_EXPORT_ROWS), for the "export" button on a table. */
  @Get(':id/tables/:table/rows/export')
  async exportTableCsv(
    @CurrentUser() user: JwtPayload,
    @Param() params: TableRowsParamsDto,
    @Query() query: TableExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const { csv, truncated } = await this.queries.exportTableCsv(
      db,
      params.table,
      query,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${params.table}.csv"`,
    );
    if (truncated) res.setHeader('X-Aoox-Truncated', 'true');
    res.send(csv);
  }

  /** Updates exactly one row, targeted by its primary key (see assertRowTarget). */
  @Patch(':id/tables/:table/rows')
  @Roles('owner', 'admin')
  async updateRow(
    @CurrentUser() user: JwtPayload,
    @Param() params: TableRowsParamsDto,
    @Body() dto: UpdateRowDto,
  ): Promise<RowActionResultDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.queries.updateRow(db, params.table, dto);
  }

  /** Deletes exactly one row, targeted by its primary key. */
  @Delete(':id/tables/:table/rows')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  async deleteRow(
    @CurrentUser() user: JwtPayload,
    @Param() params: TableRowsParamsDto,
    @Body() dto: DeleteRowDto,
  ): Promise<RowActionResultDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.queries.deleteRow(db, params.table, dto);
  }

  @Post(':id/query')
  @HttpCode(HttpStatus.OK)
  async query(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: RunQueryDto,
  ): Promise<QueryResultDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const started = Date.now();
    try {
      const result = await this.queries.runQuery(
        db,
        dto.sql,
        user.role,
        dto.db,
      );
      this.recordHistory({
        databaseId: db.id,
        userId: user.sub,
        db: dto.db ?? null,
        sql: dto.sql,
        success: true,
        errorMessage: null,
        rowCount: result.rows.length,
        durationMs: result.durationMs,
      });
      return result;
    } catch (err) {
      this.recordHistory({
        databaseId: db.id,
        userId: user.sub,
        db: dto.db ?? null,
        sql: dto.sql,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        rowCount: null,
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  /** Fire-and-forget: a broken history write must never fail the query itself. */
  private recordHistory(
    input: Parameters<QueryHistoryService['record']>[0],
  ): void {
    this.history
      .record(input)
      .catch((err) =>
        this.logger.warn(`Query history write failed: ${String(err)}`),
      );
  }

  /** Plain SQL dump of one database as a download (`<slug>[-db].sql`). */
  @Get(':id/export')
  async exportSql(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Query() query: DatabaseSelectDto,
    @Res() res: Response,
  ): Promise<void> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const name = `${db.slug}${query.db ? `-${query.db}` : ''}.sql`;
    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    await this.queries.exportSql(db, query.db, res);
    res.end();
  }

  /** Runs an uploaded `.sql` file (multipart field `file`) against one database. */
  @Post(':id/import')
  @Roles('owner', 'admin')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES } }),
  )
  @HttpCode(HttpStatus.OK)
  async importSql(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Query() query: DatabaseSelectDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ message: string }> {
    if (!file) throw new BadRequestException('Upload a .sql file as "file"');
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.queries.importSql(db, query.db, file.buffer);
  }
}
