import { Controller, Get, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { HostLiveMetrics } from '../host-metrics.service';
import { HostMetricsService } from '../host-metrics.service';

/** Live host CPU/RAM for the dashboard chart; polled every 2 s, served from memory. */
@Controller('monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class HostLiveController {
  constructor(private readonly host: HostMetricsService) {}

  // Above the global 300/min so a few open dashboards do not trip it.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('host/live')
  live(): HostLiveMetrics {
    return this.host.live();
  }
}
