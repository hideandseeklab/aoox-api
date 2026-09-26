import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PanelDomainService, PanelDomainStatus } from './panel-domain.service';

@Controller('instance/domain')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class GetPanelDomainController {
  constructor(private readonly panelDomain: PanelDomainService) {}

  @Get()
  get(): Promise<PanelDomainStatus> {
    return this.panelDomain.status();
  }
}
