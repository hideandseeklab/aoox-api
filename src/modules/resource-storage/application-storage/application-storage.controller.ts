import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../../application/application.service';
import { ResourceStorageService } from '../resource-storage.service';
import { ResourceStorageDto, StorageParamsDto } from '../storage.dto';

/** Disk use of one application, measured on demand (see AGENTS.md, Resource storage). */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationStorageController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly storage: ResourceStorageService,
  ) {}

  // `/system/df` walks every volume; keep it from being hammered.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':id/storage')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: StorageParamsDto,
  ): Promise<ResourceStorageDto> {
    // Any project member may read sizes; outsiders get 404 from findOwnedOrFail.
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.storage.forApplication(app);
  }
}
