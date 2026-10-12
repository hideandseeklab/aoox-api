import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { RestoreVersionDto, VersionParamsDto } from '../environment.dto';
import {
  actorOf,
  EnvironmentView,
  ProjectEnvironmentService,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class RestoreEnvironmentVersionController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Writes the old text as a new version; same rule as editing. */
  @Post(':envId/versions/:versionId/restore')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  restore(
    @CurrentUser() user: JwtPayload & { tokenId?: string },
    @Param() params: VersionParamsDto,
    @Body() dto: RestoreVersionDto,
  ): Promise<EnvironmentView> {
    return this.environments.restoreVersion(
      actorOf(user),
      params.id,
      params.envId,
      params.versionId,
      dto.expectedUpdatedAt,
    );
  }
}
