import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import {
  CompanionDto,
  CompanionParamsDto,
  CreateCompanionDto,
} from '../companion.dto';
import { DatabaseCompanionService } from '../database-companion.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CreateCompanionController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly companions: DatabaseCompanionService,
  ) {}

  /** A POST is a write: project viewers are refused by `findOwnedOrFail`. */
  @Post(':id/companion')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Param() params: CompanionParamsDto,
    @Body() dto: CreateCompanionDto,
  ): Promise<CompanionDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.companions.create(db, dto);
  }
}
