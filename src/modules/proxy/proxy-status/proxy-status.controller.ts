import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ProxyService, ProxyStatus } from '../proxy.service';

@Controller('proxy')
@UseGuards(JwtAuthGuard)
export class ProxyStatusController {
  constructor(private readonly proxy: ProxyService) {}

  @Get()
  status(): Promise<ProxyStatus> {
    return this.proxy.status();
  }
}
