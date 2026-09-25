import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectService } from '../../project/project.service';
import { ManagedDatabase } from '../managed-database.entity';
import { ManagedDatabaseService } from '../managed-database.service';
import { ListDatabasesQueryDto } from './list-databases.dto';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class ListDatabasesController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly projects: ProjectService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListDatabasesQueryDto,
  ): Promise<ManagedDatabase[]> {
    await this.projects.findOwnedOrFail(query.projectId, user.sub);
    return this.databases.repo.find({
      where: { projectId: query.projectId },
      order: { createdAt: 'DESC' },
    });
  }
}
