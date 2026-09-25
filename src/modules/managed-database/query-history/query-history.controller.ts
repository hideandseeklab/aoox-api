import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { ManagedDatabaseService } from '../managed-database.service';
import { QueryHistoryEntryDto } from './query-history.dto';
import { QueryHistoryService } from './query-history.service';

/**
 * A member's own recent queries against one database — "what did I just
 * run", not an audit trail (that's /audit-logs, platform-wide). No @Roles:
 * every member gets their own history, same as the query box itself.
 */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class QueryHistoryController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly history: QueryHistoryService,
  ) {}

  @Get(':id/query-history')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<QueryHistoryEntryDto[]> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.history.list(db.id, user.sub);
  }

  @Delete(':id/query-history')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<void> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    await this.history.clear(db.id, user.sub);
  }
}
