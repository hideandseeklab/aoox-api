import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { CompanionDto, CompanionParamsDto } from '../companion.dto';
import { DatabaseCompanionService } from '../database-companion.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class GetCompanionController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly companions: DatabaseCompanionService,
  ) {}

  /**
   * The admin app of a database, or the JSON literal `null`. Never carries
   * the password. Nest sends an empty body for a nil result, which
   * `response.json()` rejects, so the `null` case is written as JSON by hand.
   */
  @Get(':id/companion')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: CompanionParamsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CompanionDto | 'null'> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const companion = await this.companions.get(db);
    if (companion) return companion;
    res.type('application/json');
    return 'null';
  }
}
