import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProxyConfigService } from '../../proxy-config/proxy-config.service';
import { ApplicationService } from '../application.service';
import { ApplicationParamsDto } from '../get-application/get-application.dto';

/** A middleware a domain of this application can use, and the file that declares it. */
export interface DomainMiddlewareOption {
  /** `name@file`, what PATCH /domains/:id takes. */
  ref: string;
  /** Config file name (slug) that declares it. */
  file: string;
}

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListDomainMiddlewaresController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly proxyConfig: ProxyConfigService,
  ) {}

  /**
   * Middlewares from the enabled operator config files of the proxy that
   * serves this application (the aoox host, or its remote server). Any member
   * of the project may read the names; the file contents stay owner/admin.
   */
  @Get(':id/domain-middlewares')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<DomainMiddlewareOption[]> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    return this.proxyConfig.availableMiddlewares(app.serverId);
  }
}
