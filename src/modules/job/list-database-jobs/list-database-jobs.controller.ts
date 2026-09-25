import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../../managed-database/get-database/get-database.dto';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { Job } from '../job.entity';
import { JobService } from '../job.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class ListDatabaseJobsController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly jobs: JobService,
  ) {}

  @Get(':id/jobs')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<Job[]> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.jobs.repo.find({
      where: { databaseId: db.id },
      order: { createdAt: 'ASC' },
    });
  }
}
