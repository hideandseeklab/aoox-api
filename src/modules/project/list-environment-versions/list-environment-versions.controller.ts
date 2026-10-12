import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { EnvironmentParamsDto } from '../environment.dto';
import {
  ProjectEnvironmentService,
  VersionView,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class ListEnvironmentVersionsController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Who changed which variable names and when. Never values; any member may read it. */
  @Get(':envId/versions')
  list(
    @CurrentUser() user: JwtPayload,
    @Param() params: EnvironmentParamsDto,
  ): Promise<VersionView[]> {
    return this.environments.listVersions(user.sub, params.id, params.envId);
  }
}
