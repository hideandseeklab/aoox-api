import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { EnvironmentParamsDto } from '../environment.dto';
import {
  actorOf,
  ProjectEnvironmentService,
  RevealView,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class RevealEnvironmentController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /**
   * POST on purpose: reading values is an event, so the audit log records it
   * and viewers are rejected by the project write rule.
   */
  @Post(':envId/reveal')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reveal(
    @CurrentUser() user: JwtPayload & { tokenId?: string },
    @Param() params: EnvironmentParamsDto,
  ): Promise<RevealView> {
    return this.environments.reveal(actorOf(user), params.id, params.envId);
  }
}
