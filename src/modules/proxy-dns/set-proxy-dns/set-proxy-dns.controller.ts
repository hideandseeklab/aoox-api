import { Body, Controller, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SetProxyDnsDto } from '../proxy-dns.dto';
import { ProxyDnsService, ProxyDnsState } from '../proxy-dns.service';

@Controller('proxy/dns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class SetProxyDnsController {
  constructor(private readonly service: ProxyDnsService) {}

  /** Binds a DNS connection to the proxy (adds the le-dns resolver; recreates a running proxy). */
  @Put()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  set(@Body() dto: SetProxyDnsDto): Promise<ProxyDnsState> {
    return this.service.enable(
      dto.serverId ?? null,
      dto.connectionId,
      dto.acceptProxyRestart === true,
    );
  }
}
