import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DiffQueryDto, ProjectParamsDto } from '../environment.dto';
import {
  EnvironmentDiff,
  ProjectEnvironmentService,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class DiffEnvironmentsController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Key-level comparison by environment name; never values (see the service). */
  @Get('diff')
  diff(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectParamsDto,
    @Query() query: DiffQueryDto,
  ): Promise<EnvironmentDiff> {
    return this.environments.diff(user.sub, params.id, query.from, query.to);
  }
}
