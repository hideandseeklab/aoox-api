import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ProxyStatus } from '../proxy.service';
import { ProvisionProxyService } from './provision-proxy.service';

@Controller('proxy')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class ProvisionProxyController {
  constructor(private readonly service: ProvisionProxyService) {}

  @Post()
  provision(): Promise<ProxyStatus> {
    return this.service.execute();
  }
}
