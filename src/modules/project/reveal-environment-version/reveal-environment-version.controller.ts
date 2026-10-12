import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { VersionParamsDto } from '../environment.dto';
import {
  actorOf,
  ProjectEnvironmentService,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class RevealEnvironmentVersionController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Same rules as revealing the environment (POST, but a read: see READ_ONLY_POSTS). */
  @Post(':envId/versions/:versionId/reveal')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reveal(
    @CurrentUser() user: JwtPayload & { tokenId?: string },
    @Param() params: VersionParamsDto,
  ) {
    return this.environments.revealVersion(
      actorOf(user),
      params.id,
      params.envId,
      params.versionId,
    );
  }
}
