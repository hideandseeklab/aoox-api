import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { JobSchedulerService } from '../job-scheduler.service';
import { JobParamsDto } from '../job.dto';
import { JobService } from '../job.service';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class DeleteJobController {
  constructor(
    private readonly jobs: JobService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: JobParamsDto,
  ): Promise<void> {
    const job = await this.jobs.findOwnedOrFail(params.id, user.sub);
    this.scheduler.unschedule(job.id);
    await this.jobs.repo.delete(job.id);
  }
}
