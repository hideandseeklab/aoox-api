import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../../application/get-application/get-application.dto';
import type { MonitorView } from '../http-monitor.service';
import { UpdateHttpMonitorDto } from './update-http-monitor.dto';
import { UpdateHttpMonitorService } from './update-http-monitor.service';

/** A write: viewers get 403 from the project access check, like every other write. */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class UpdateHttpMonitorController {
  constructor(private readonly service: UpdateHttpMonitorService) {}

  @Put(':id/monitor')
  update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: UpdateHttpMonitorDto,
  ): Promise<MonitorView> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
