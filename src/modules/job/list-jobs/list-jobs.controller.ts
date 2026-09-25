import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApplicationService } from '../../application/application.service';
import { ApplicationParamsDto } from '../../application/get-application/get-application.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Job } from '../job.entity';
import { JobService } from '../job.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListJobsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly jobs: JobService,
  ) {}

  @Get(':id/jobs')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Job[]> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.jobs.repo.find({
      where: { applicationId: app.id },
      order: { createdAt: 'ASC' },
    });
  }
}
