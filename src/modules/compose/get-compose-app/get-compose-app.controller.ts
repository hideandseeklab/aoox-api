import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectAccessService } from '../../project/project-access.service';
import type { ProjectRole } from '../../project/project-member.entity';
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeApp } from '../compose-app.entity';
import { hideEnv, type WithEnvHidden } from '../../project/env-visibility';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeContainer, ComposeService } from '../compose.service';
import { OwnerVariableSetsService } from '../../application/variable-set-links/variable-set-links.service';
import type { LinkView } from '../../variable-set/variable-set-link.service';

export type ComposeAppDetail = WithEnvHidden<ComposeApp> & ComposeAppExtras;

interface ComposeAppExtras {
  /** Live containers of the stack (empty when never deployed / torn down). */
  containers: ComposeContainer[];
  /** Id of the run whose output `logs` carries, for the history view. */
  deploymentId: string | null;
  /** The actor's role in the owning project (UI hides what a viewer cannot do). */
  projectRole: ProjectRole;
  /** Linked variable set environments in merge order (no values), with per-key conflicts. */
  variableSets: LinkView[];
}

/** Row + logs + live containers; the web polls this while status is `deploying`. */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class GetComposeAppController {
  constructor(
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
    private readonly access: ProjectAccessService,
    private readonly variableSets: OwnerVariableSetsService,
  ) {}

  @Get(':id')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeAppDetail> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    // While a run is in flight its own row holds the live output; the
    // column is only written when it finishes.
    const [containers, latest, projectRole, variableSets] = await Promise.all([
      this.compose.containers(app),
      this.runner.runs.findOne({
        where: { composeAppId: app.id },
        order: { startedAt: 'DESC' },
      }),
      this.access.roleFor(user.sub, app.project),
      this.variableSets.views(
        { kind: 'compose', id: app.id, projectId: app.projectId },
        app.env,
      ),
    ]);
    return {
      ...hideEnv(app, projectRole !== null && projectRole !== 'viewer'),
      logs: latest?.status === 'running' ? latest.logs : app.logs,
      containers,
      deploymentId: latest?.id ?? null,
      projectRole: projectRole!,
      variableSets,
    };
  }
}
