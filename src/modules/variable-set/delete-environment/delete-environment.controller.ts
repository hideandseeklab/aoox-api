import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { EnvironmentParamsDto } from '../variable-set.dto';
import { VariableSetEnvironmentService } from '../variable-set-environment.service';

@Controller('variable-sets/:id/environments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteEnvironmentController {
  constructor(private readonly environments: VariableSetEnvironmentService) {}

  /** Instance owners/admins; an environment still linked anywhere is 409. */
  @Delete(':envId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: EnvironmentParamsDto,
  ): Promise<void> {
    await this.environments.remove(user.sub, params.id, params.envId);
  }
}
