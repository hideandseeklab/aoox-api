import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { EnvironmentParamsDto } from '../environment.dto';
import { ProjectEnvironmentService } from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class DeleteEnvironmentController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Project admins only; `production` and environments still in use are refused. */
  @Delete(':envId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: EnvironmentParamsDto,
  ): Promise<void> {
    await this.environments.remove(user.sub, params.id, params.envId);
  }
}
