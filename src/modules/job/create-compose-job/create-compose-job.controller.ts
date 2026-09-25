import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeAppParamsDto } from '../../compose/compose-app.dto';
import { ComposeService } from '../../compose/compose.service';
import { JobSchedulerService } from '../job-scheduler.service';
import { Job } from '../job.entity';
import { JobService } from '../job.service';
import { CreateComposeJobDto } from './create-compose-job.dto';

@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class CreateComposeJobController {
  constructor(
    private readonly compose: ComposeService,
    private readonly jobs: JobService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  @Post(':id/jobs')
  async create(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
    @Body() dto: CreateComposeJobDto,
  ): Promise<Job> {
    const stack = await this.compose.findOwnedOrFail(params.id, user.sub);
    const { service, ...rest } = dto;
    const job = await this.jobs.repo.save(
      this.jobs.build({ composeAppId: stack.id }, rest, service),
    );
    this.scheduler.reschedule(job);
    return job;
  }
}
