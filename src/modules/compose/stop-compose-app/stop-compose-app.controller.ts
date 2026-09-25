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
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeApp } from '../compose-app.entity';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeService } from '../compose.service';

/** Queues `docker compose stop` (202); poll GET /compose-apps/:id for status and logs. */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class StopComposeAppController {
  constructor(
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
  ) {}

  @Post(':id/stop')
  @HttpCode(HttpStatus.ACCEPTED)
  async stop(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeApp> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    if (this.runner.isActive(app.id)) {
      throw new ConflictException('A compose action is still running');
    }
    this.runner.start(app, 'stop');
    return { ...app, status: 'deploying' };
  }
}
