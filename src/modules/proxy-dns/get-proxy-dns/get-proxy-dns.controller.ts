import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyDnsQueryDto } from '../proxy-dns.dto';
import { ProxyDnsService, ProxyDnsState } from '../proxy-dns.service';

@Controller('proxy/dns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class GetProxyDnsController {
  constructor(private readonly service: ProxyDnsService) {}

  @Get()
  get(@Query() q: ProxyDnsQueryDto): Promise<ProxyDnsState> {
    return this.service.state(q.serverId ?? null);
  }
}
