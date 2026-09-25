import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ListProjectsDto } from './list-projects.dto';
import {
  ListProjectsService,
  ProjectListItemDto,
} from './list-projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ListProjectsController {
  constructor(private readonly service: ListProjectsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() dto: ListProjectsDto,
  ): Promise<ProjectListItemDto[]> {
    return this.service.execute(user.sub, dto);
  }
}
