import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyServerQueryDto } from '../proxy-config-params.dto';
import { ProxyConfigState } from '../proxy-config-sync.service';
import { ProxyConfigItem, ProxyConfigService } from '../proxy-config.service';

@Controller('proxy/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListProxyConfigController {
  constructor(private readonly service: ProxyConfigService) {}

  /** The operator dynamic config files of one proxy (no content). */
  @Get()
  list(@Query() query: ProxyServerQueryDto): Promise<ProxyConfigItem[]> {
    return this.service.list(query.serverId ?? null);
  }

  /** Whether the first write would recreate the proxy (older aoox); read it before saving. */
  @Get('status')
  status(@Query() query: ProxyServerQueryDto): Promise<ProxyConfigState> {
    return this.service.state(query.serverId ?? null);
  }
}
