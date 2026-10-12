import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProxyDnsBindingService } from '../../dns-provider/proxy-dns-binding.service';
import { ApplicationService } from '../application.service';
import { ApplicationParamsDto } from '../get-application/get-application.dto';

export interface DomainDnsOptions {
  /** The proxy serving this application has a DNS connection bound (DNS-01 certificates are available). */
  proxyDnsEnabled: boolean;
}

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class DomainDnsOptionsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly bindings: ProxyDnsBindingService,
  ) {}

  /** Whether DNS-01 certificate modes can be chosen for this application's domains. */
  @Get(':id/dns-options')
  async get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<DomainDnsOptions> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return { proxyDnsEnabled: !!(await this.bindings.get(app.serverId)) };
  }
}
