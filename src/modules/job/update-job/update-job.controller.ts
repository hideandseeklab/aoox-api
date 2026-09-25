import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { JobSchedulerService } from '../job-scheduler.service';
import { JobParamsDto, UpdateJobDto } from '../job.dto';
import { Job } from '../job.entity';
import { JobService } from '../job.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class UpdateJobController {
  constructor(
    private readonly jobs: JobService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: JobParamsDto,
    @Body() dto: UpdateJobDto,
  ): Promise<Job> {
    const job = await this.jobs.findOwnedOrFail(params.id, user.sub);
    const patch: Partial<Job> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.cron !== undefined) {
      const cron = dto.cron?.trim() || null;
      if (cron && !JobSchedulerService.isValidCron(cron)) {
        throw new BadRequestException('cron is not a valid expression');
      }
      patch.cron = cron;
    }
    if (dto.command !== undefined) patch.command = dto.command;
    if (dto.target !== undefined) patch.target = dto.target;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.timeoutSeconds !== undefined)
      patch.timeoutSeconds = dto.timeoutSeconds;
    if (dto.service !== undefined && job.composeAppId)
      patch.service = dto.service;
    await this.jobs.repo.update(job.id, patch);
    const saved = await this.jobs.repo.findOneByOrFail({ id: job.id });
    this.scheduler.reschedule(saved);
    return saved;
  }
}
