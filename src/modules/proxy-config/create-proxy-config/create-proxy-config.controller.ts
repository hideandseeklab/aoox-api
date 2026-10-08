import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyConfigService, ProxyConfigWrite } from '../proxy-config.service';
import { CreateProxyConfigDto } from './create-proxy-config.dto';

@Controller('proxy/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class CreateProxyConfigController {
  constructor(private readonly service: ProxyConfigService) {}

  /** Validates, saves and writes the file; answers with the proxy verdict (`sync`). */
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(@Body() dto: CreateProxyConfigDto): Promise<ProxyConfigWrite> {
    return this.service.create(
      dto.serverId ?? null,
      dto.name,
      dto.content,
      dto.enabled ?? true,
      dto.acceptProxyRestart ?? false,
    );
  }
}
