import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { CreateEnvironmentDto, ProjectParamsDto } from '../environment.dto';
import {
  EnvironmentView,
  ProjectEnvironmentService,
} from '../project-environment.service';

@Controller('projects/:id/environments')
@UseGuards(JwtAuthGuard)
export class CreateEnvironmentController {
  constructor(private readonly environments: ProjectEnvironmentService) {}

  /** Developers and up. New environments are never protected. */
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectParamsDto,
    @Body() dto: CreateEnvironmentDto,
  ): Promise<EnvironmentView> {
    return this.environments.create(user.sub, params.id, dto.name);
  }
}
