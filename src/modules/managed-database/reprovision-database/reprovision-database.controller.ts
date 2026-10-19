import {
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
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { ManagedDatabase } from '../managed-database.entity';
import { ManagedDatabaseService } from '../managed-database.service';

/**
 * Retry provisioning of a database in `error`. A POST is a write, so viewers
 * are refused by `findOwnedOrFail` (403) and outsiders get 404. Answers 202
 * with the row in `creating`; it ends in `running` or `error` in the
 * background, like create.
 */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class ReprovisionDatabaseController {
  constructor(private readonly databases: ManagedDatabaseService) {}

  @Post(':id/reprovision')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async reprovision(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<ManagedDatabase> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.databases.retryProvisioning(db);
  }
}
