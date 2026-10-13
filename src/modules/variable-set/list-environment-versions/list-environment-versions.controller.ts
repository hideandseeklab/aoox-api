import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { EnvironmentParamsDto } from '../variable-set.dto';
import {
  VariableSetEnvironmentService,
  VersionView,
} from '../variable-set-environment.service';

@Controller('variable-sets/:id/environments')
@UseGuards(JwtAuthGuard)
export class ListEnvironmentVersionsController {
  constructor(private readonly environments: VariableSetEnvironmentService) {}

  /** Newest first; who, when, which keys. Never values. */
  @Get(':envId/versions')
  list(
    @CurrentUser() user: JwtPayload,
    @Param() params: EnvironmentParamsDto,
  ): Promise<VersionView[]> {
    return this.environments.listVersions(user.sub, params.id, params.envId);
  }
}
