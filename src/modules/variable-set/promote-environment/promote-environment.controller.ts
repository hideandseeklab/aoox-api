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
import { EnvironmentParamsDto, PromoteDto } from '../variable-set.dto';
import {
  actorOf,
  VariableSetEnvironmentService,
} from '../variable-set-environment.service';

@Controller('variable-sets/:id/environments')
@UseGuards(JwtAuthGuard)
export class PromoteEnvironmentController {
  constructor(private readonly environments: VariableSetEnvironmentService) {}

  /** Copies the chosen variables from `from` into this environment (`:envId` is the target). */
  @Post(':envId/promote')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  promote(
    @CurrentUser() user: JwtPayload & { tokenId?: string },
    @Param() params: EnvironmentParamsDto,
    @Body() dto: PromoteDto,
  ) {
    return this.environments.promote(
      actorOf(user),
      params.id,
      params.envId,
      dto.from,
      dto.keys,
      dto.expectedUpdatedAt,
    );
  }
}
