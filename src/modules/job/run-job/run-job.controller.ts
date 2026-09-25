import {
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { JobRun } from '../job-run.entity';
import { JobRunnerService } from '../job-runner.service';
import { JobParamsDto } from '../job.dto';
import { JobService } from '../job.service';

/** Runs the job now (202); poll GET /jobs/:id/runs for the result. */
@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class RunJobController {
  constructor(
    private readonly jobs: JobService,
    private readonly runner: JobRunnerService,
  ) {}

  @Post(':id/run')
  @HttpCode(HttpStatus.ACCEPTED)
  async run(
    @CurrentUser() user: JwtPayload,
    @Param() params: JobParamsDto,
  ): Promise<JobRun> {
    const job = await this.jobs.findOwnedOrFail(params.id, user.sub);
    if (this.runner.isActive(job.id)) {
      throw new ConflictException('Job is already running');
    }
    return this.runner.start(job, 'manual');
  }
}
