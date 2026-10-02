import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApplicationParamsDto } from '../../application/get-application/get-application.dto';
import { ApplicationService } from '../../application/application.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { HttpMonitorService, type MonitorView } from '../http-monitor.service';

/**
 * "Check now": runs the saved monitor once (and records it like a scheduled
 * check, alerts included). Needs a saved config and a running application.
 */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CheckHttpMonitorController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly monitors: HttpMonitorService,
  ) {}

  @Post(':id/monitor/check')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async check(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<MonitorView> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const monitor = await this.monitors.findByApp(app.id);
    if (!monitor)
      throw new BadRequestException('Save the monitor settings first');
    if (app.status !== 'running')
      throw new ConflictException('The application is not running');
    await this.monitors.check(monitor, app);
    return this.monitors.view(app);
  }
}
