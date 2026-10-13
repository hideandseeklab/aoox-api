import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { EnvironmentParamsDto } from '../variable-set.dto';
import {
  actorOf,
  RevealView,
  VariableSetEnvironmentService,
} from '../variable-set-environment.service';

@Controller('variable-sets/:id/environments')
@UseGuards(JwtAuthGuard)
export class RevealEnvironmentController {
  constructor(private readonly environments: VariableSetEnvironmentService) {}

  /**
   * POST on purpose: reading values is an event, so the audit log records it.
   * Listed in READ_ONLY_POSTS, so read-only API tokens may call it; viewers
   * are refused by the service.
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
