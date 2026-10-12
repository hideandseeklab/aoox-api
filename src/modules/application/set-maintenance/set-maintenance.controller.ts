import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { SetMaintenanceDto } from './set-maintenance.dto';
import {
  MaintenanceView,
  SetMaintenanceService,
} from './set-maintenance.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class SetMaintenanceController {
  constructor(private readonly service: SetMaintenanceService) {}

  /** PUT = write: viewers get 403 from the project access rules. */
  @Put(':id/maintenance')
  set(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: SetMaintenanceDto,
  ): Promise<MaintenanceView> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
