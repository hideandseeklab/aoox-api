import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Application } from '../application.entity';
import { ListApplicationsQueryDto } from './list-applications.dto';
import { ListApplicationsService } from './list-applications.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListApplicationsController {
  constructor(private readonly service: ListApplicationsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<Application[]> {
    return this.service.execute(user.sub, query.projectId);
  }
}
