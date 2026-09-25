import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ComposeDeployment } from '../compose-deployment.entity';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeService } from '../compose.service';

export class ComposeDeploymentParamsDto {
  @IsUUID()
  id: string;
}

/** One run with its full output; the web polls this while it is `running`. */
@Controller('compose-deployments')
@UseGuards(JwtAuthGuard)
export class GetComposeDeploymentController {
  constructor(
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
  ) {}

  @Get(':id')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeDeploymentParamsDto,
  ): Promise<ComposeDeployment> {
    const run = await this.runner.runs.findOne({ where: { id: params.id } });
    if (!run) throw new NotFoundException('Compose deployment not found');
    // Access is decided by the stack's project, like every other flow.
    await this.compose.findOwnedOrFail(run.composeAppId, user.sub);
    return run;
  }
}
