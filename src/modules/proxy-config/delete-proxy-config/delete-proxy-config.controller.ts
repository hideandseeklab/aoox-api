import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyConfigParamsDto } from '../proxy-config-params.dto';
import { ProxyConfigService } from '../proxy-config.service';

@Controller('proxy/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class DeleteProxyConfigController {
  constructor(private readonly service: ProxyConfigService) {}

  /** 409 while a domain still uses one of the file middlewares. */
  @Delete(':id')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async remove(@Param() params: ProxyConfigParamsDto): Promise<void> {
    await this.service.remove(params.id);
  }
}
