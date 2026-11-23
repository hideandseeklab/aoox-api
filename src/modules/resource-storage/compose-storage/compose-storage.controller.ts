import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeService } from '../../compose/compose.service';
import { ResourceStorageService } from '../resource-storage.service';
import { ResourceStorageDto, StorageParamsDto } from '../storage.dto';

/** Disk use of one compose stack, measured on demand. */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class ComposeStorageController {
  constructor(
    private readonly compose: ComposeService,
    private readonly storage: ResourceStorageService,
  ) {}

  // `/system/df` walks every volume; keep it from being hammered.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':id/storage')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: StorageParamsDto,
  ): Promise<ResourceStorageDto> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    return this.storage.forCompose(app);
  }
}
