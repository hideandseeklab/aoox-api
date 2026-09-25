import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeApp } from '../compose-app.entity';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeContainer, ComposeService } from '../compose.service';

export interface ComposeAppDetail extends ComposeApp {
  /** Live containers of the stack (empty when never deployed / torn down). */
  containers: ComposeContainer[];
  /** Id of the run whose output `logs` carries, for the history view. */
  deploymentId: string | null;
}

/** Row + logs + live containers; the web polls this while status is `deploying`. */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class GetComposeAppController {
  constructor(
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
  ) {}

  @Get(':id')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeAppDetail> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    // While a run is in flight its own row holds the live output; the
    // column is only written when it finishes.
    const [containers, latest] = await Promise.all([
      this.compose.containers(app),
      this.runner.runs.findOne({
        where: { composeAppId: app.id },
        order: { startedAt: 'DESC' },
      }),
    ]);
    return {
      ...app,
      logs: latest?.status === 'running' ? latest.logs : app.logs,
      containers,
      deploymentId: latest?.id ?? null,
    };
  }
}
