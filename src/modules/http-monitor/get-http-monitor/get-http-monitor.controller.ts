import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApplicationParamsDto } from '../../application/get-application/get-application.dto';
import { ApplicationService } from '../../application/application.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { HttpMonitorService, type MonitorView } from '../http-monitor.service';

/** Config, current status, uptime/latency and recent incidents of one application. */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class GetHttpMonitorController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly monitors: HttpMonitorService,
  ) {}

  @Get(':id/monitor')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<MonitorView> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.monitors.view(app);
  }
}
