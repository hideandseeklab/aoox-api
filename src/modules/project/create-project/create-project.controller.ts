import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Project } from '../project.entity';
import { CreateProjectDto } from './create-project.dto';
import { CreateProjectService } from './create-project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class CreateProjectController {
  constructor(private readonly service: CreateProjectService) {}

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProjectDto,
  ): Promise<Project> {
    return this.service.execute(user.sub, dto);
  }
}
