import { Controller, Delete, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ClearProxyDnsQueryDto } from '../proxy-dns.dto';
import { ProxyDnsService, ProxyDnsState } from '../proxy-dns.service';

@Controller('proxy/dns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class ClearProxyDnsController {
  constructor(private readonly service: ProxyDnsService) {}

  @Delete()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  clear(@Query() q: ClearProxyDnsQueryDto): Promise<ProxyDnsState> {
    return this.service.disable(
      q.serverId ?? null,
      q.acceptProxyRestart === true,
    );
  }
}
