import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyConfigParamsDto } from '../proxy-config-params.dto';
import { ProxyConfigService, ProxyConfigWrite } from '../proxy-config.service';
import { UpdateProxyConfigDto } from './update-proxy-config.dto';

@Controller('proxy/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class UpdateProxyConfigController {
  constructor(private readonly service: ProxyConfigService) {}

  @Put(':id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  update(
    @Param() params: ProxyConfigParamsDto,
    @Body() dto: UpdateProxyConfigDto,
  ): Promise<ProxyConfigWrite> {
    if (dto.content === undefined && dto.enabled === undefined) {
      throw new BadRequestException('Send content and/or enabled');
    }
    return this.service.update(params.id, dto);
  }
}
