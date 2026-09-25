import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { HostOverview } from '../monitoring.service';
import { MonitoringService } from '../monitoring.service';

/** Host-level numbers (CPUs, RAM, Docker disk usage) for the dashboard. */
@Controller('monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class HostOverviewController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('host')
  host(): Promise<HostOverview> {
    return this.monitoring.hostOverview();
  }
}
