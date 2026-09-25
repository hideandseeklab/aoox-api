import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Project } from '../project.entity';
import { UpdateProjectDto, UpdateProjectParamsDto } from './update-project.dto';
import { UpdateProjectService } from './update-project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class UpdateProjectController {
  constructor(private readonly service: UpdateProjectService) {}

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param() params: UpdateProjectParamsDto,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
