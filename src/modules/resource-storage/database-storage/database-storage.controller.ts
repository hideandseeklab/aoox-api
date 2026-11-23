import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { ResourceStorageService } from '../resource-storage.service';
import { ResourceStorageDto, StorageParamsDto } from '../storage.dto';

/** Disk use of one managed database, measured on demand. */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DatabaseStorageController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly storage: ResourceStorageService,
  ) {}

  // `/system/df` walks every volume; keep it from being hammered.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':id/storage')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: StorageParamsDto,
  ): Promise<ResourceStorageDto> {
    // Sizes are not data or credentials: viewers may read them, outsiders get 404.
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.storage.forDatabase(db);
  }
}
