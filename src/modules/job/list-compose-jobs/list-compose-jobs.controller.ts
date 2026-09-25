import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeAppParamsDto } from '../../compose/compose-app.dto';
import { ComposeService } from '../../compose/compose.service';
import { Job } from '../job.entity';
import { JobService } from '../job.service';

@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class ListComposeJobsController {
  constructor(
    private readonly compose: ComposeService,
    private readonly jobs: JobService,
  ) {}

  @Get(':id/jobs')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<Job[]> {
    const stack = await this.compose.findOwnedOrFail(params.id, user.sub);
    return this.jobs.repo.find({
      where: { composeAppId: stack.id },
      order: { createdAt: 'ASC' },
    });
  }
}
