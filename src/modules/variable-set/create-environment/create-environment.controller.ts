import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CreateEnvironmentDto, SetParamsDto } from '../variable-set.dto';
import {
  EnvironmentView,
  VariableSetEnvironmentService,
} from '../variable-set-environment.service';

@Controller('variable-sets/:id/environments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateEnvironmentController {
  constructor(private readonly environments: VariableSetEnvironmentService) {}

  /** Instance owners/admins add an environment (optionally protected). */
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: SetParamsDto,
    @Body() dto: CreateEnvironmentDto,
  ): Promise<EnvironmentView> {
    return this.environments.create(
      user.sub,
      params.id,
      dto.name,
      dto.protected ?? false,
    );
  }
}
