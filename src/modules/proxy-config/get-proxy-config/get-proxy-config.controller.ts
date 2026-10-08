import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyConfigParamsDto } from '../proxy-config-params.dto';
import { ProxyConfigDetail, ProxyConfigService } from '../proxy-config.service';

@Controller('proxy/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class GetProxyConfigController {
  constructor(private readonly service: ProxyConfigService) {}

  @Get(':id')
  get(@Param() params: ProxyConfigParamsDto): Promise<ProxyConfigDetail> {
    return this.service.get(params.id);
  }
}
