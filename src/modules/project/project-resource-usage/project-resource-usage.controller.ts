import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectService } from '../project.service';
import {
  ProjectResourceUsageParamsDto,
  ProjectResourceUsageResponseDto,
} from './project-resource-usage.dto';
import { ProjectResourceUsageService } from './project-resource-usage.service';

/** CPU/RAM/network summary for the project detail page — live only, see ProjectResourceUsageService. */
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectResourceUsageController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly usage: ProjectResourceUsageService,
  ) {}

  @Get(':id/resource-usage')
  async resourceUsage(
    @CurrentUser() user: JwtPayload,
    @Param() params: ProjectResourceUsageParamsDto,
  ): Promise<ProjectResourceUsageResponseDto> {
    const project = await this.projectService.findOwnedOrFail(
      params.id,
      user.sub,
    );
    return (
      (await this.usage.usageForProject(project.id)) ?? {
        current: null,
        history: [],
        containers: 0,
      }
    );
  }
}
