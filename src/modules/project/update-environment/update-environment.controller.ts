import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { EnvironmentParamsDto, UpdateEnvironmentDto } from '../environment.dto';
import {
  actorOf,
  EnvironmentView,
  ProjectEnvironmentService,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class UpdateEnvironmentController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Replaces the variables. Apps pick them up on their next deploy. */
  @Put(':envId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  update(
    @CurrentUser() user: JwtPayload & { tokenId?: string },
    @Param() params: EnvironmentParamsDto,
    @Body() dto: UpdateEnvironmentDto,
  ): Promise<EnvironmentView> {
    return this.environments.update(
      actorOf(user),
      params.id,
      params.envId,
      dto.variables,
      dto.expectedUpdatedAt,
      { flags: dto.flags, action: dto.action },
    );
  }
}
