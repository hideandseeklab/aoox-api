import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { JobRun } from '../job-run.entity';
import { JobParamsDto } from '../job.dto';
import { JobService } from '../job.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class ListJobRunsController {
  constructor(private readonly jobs: JobService) {}

  @Get(':id/runs')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: JobParamsDto,
  ): Promise<JobRun[]> {
    const job = await this.jobs.findOwnedOrFail(params.id, user.sub);
    return this.jobs.runs.find({
      where: { jobId: job.id },
      order: { startedAt: 'DESC' },
      take: 20,
    });
  }
}
