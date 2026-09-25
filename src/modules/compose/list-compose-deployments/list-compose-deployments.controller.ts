import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeDeployment } from '../compose-deployment.entity';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeService } from '../compose.service';

export type ComposeDeploymentSummary = Omit<
  ComposeDeployment,
  'logs' | 'composeApp'
>;

/** Run history of a stack, newest first and without logs (see get-compose-deployment). */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class ListComposeDeploymentsController {
  constructor(
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
  ) {}

  @Get(':id/deployments')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeDeploymentSummary[]> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    return this.runner.runs.find({
      where: { composeAppId: app.id },
      order: { startedAt: 'DESC' },
      take: 20,
      select: {
        id: true,
        composeAppId: true,
        action: true,
        trigger: true,
        status: true,
        errorMessage: true,
        commitSha: true,
        startedAt: true,
        finishedAt: true,
      },
    });
  }
}
