import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApplicationService } from '../../application/application.service';
import { ApplicationParamsDto } from '../../application/get-application/get-application.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { JobSchedulerService } from '../job-scheduler.service';
import { Job } from '../job.entity';
import { JobService } from '../job.service';
import { CreateJobDto } from './create-job.dto';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CreateJobController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly jobs: JobService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  @Post(':id/jobs')
  async create(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: CreateJobDto,
  ): Promise<Job> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const job = await this.jobs.repo.save(
      this.jobs.build({ applicationId: app.id }, dto),
    );
    this.scheduler.reschedule(job);
    return job;
  }
}
