import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { CompanionOptionsDto, CompanionParamsDto } from '../companion.dto';
import { DatabaseCompanionService } from '../database-companion.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CompanionOptionsController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly companions: DatabaseCompanionService,
  ) {}

  /** Admin tools that can be installed for this database engine. */
  @Get(':id/companion/options')
  async options(
    @CurrentUser() user: JwtPayload,
    @Param() params: CompanionParamsDto,
  ): Promise<CompanionOptionsDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.companions.options(db);
  }
}
