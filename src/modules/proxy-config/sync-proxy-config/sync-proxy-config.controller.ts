import { Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyServerQueryDto } from '../proxy-config-params.dto';
import { SyncReport } from '../proxy-config-sync.service';
import { ProxyConfigService } from '../proxy-config.service';

@Controller('proxy/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class SyncProxyConfigController {
  constructor(private readonly service: ProxyConfigService) {}

  /** Writes every enabled file again (volume lost, proxy recreated, restore). */
  @Post('sync')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sync(@Query() query: ProxyServerQueryDto): Promise<SyncReport> {
    return this.service.resync(
      query.serverId ?? null,
      query.acceptProxyRestart === 'true',
    );
  }
}
