import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { CompanionCredentialsDto, CompanionParamsDto } from '../companion.dto';
import { DatabaseCompanionService } from '../database-companion.service';

/** Generated login, kept off `GET /databases/:id/companion` like `database-credentials`. */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CompanionCredentialsController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly companions: DatabaseCompanionService,
  ) {}

  @Get(':id/companion/credentials')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: CompanionParamsDto,
  ): Promise<CompanionCredentialsDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.companions.credentials(user.sub, db);
  }
}
