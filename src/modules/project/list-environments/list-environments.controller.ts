import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectParamsDto } from '../environment.dto';
import {
  EnvironmentView,
  ProjectEnvironmentService,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class ListEnvironmentsController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Names, protection, variable names and users. Never values. */
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectParamsDto,
  ): Promise<EnvironmentView[]> {
    return this.environments.list(user.sub, params.id);
  }
}
