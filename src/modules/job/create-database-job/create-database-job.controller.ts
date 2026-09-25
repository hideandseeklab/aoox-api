import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../../managed-database/get-database/get-database.dto';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { CreateJobDto } from '../create-job/create-job.dto';
import { JobSchedulerService } from '../job-scheduler.service';
import { Job } from '../job.entity';
import { JobService } from '../job.service';

/** e.g. `psql -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" -c 'VACUUM ANALYZE'` as a `run` job. */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CreateDatabaseJobController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly jobs: JobService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  @Post(':id/jobs')
  async create(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: CreateJobDto,
  ): Promise<Job> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const job = await this.jobs.repo.save(
      this.jobs.build({ databaseId: db.id }, dto),
    );
    this.scheduler.reschedule(job);
    return job;
  }
}
