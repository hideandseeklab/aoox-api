import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Project } from '../project.entity';
import { GetProjectParamsDto } from './get-project.dto';
import { GetProjectService } from './get-project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class GetProjectController {
  constructor(private readonly service: GetProjectService) {}

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param() params: GetProjectParamsDto,
  ): Promise<Project> {
    return this.service.execute(user.sub, params.id);
  }
}
