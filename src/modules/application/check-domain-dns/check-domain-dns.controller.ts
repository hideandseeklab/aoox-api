import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { DeleteDomainParamsDto } from '../delete-domain/delete-domain.dto';
import { DnsCheckDto } from './check-domain-dns.dto';
import { CheckDomainDnsService } from './check-domain-dns.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CheckDomainDnsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly service: CheckDomainDnsService,
  ) {}

  /** Each call hits the resolver (and possibly the public-IP lookup). */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':id/domains/:domainId/dns')
  async check(
    @CurrentUser() user: JwtPayload,
    @Param() params: DeleteDomainParamsDto,
  ): Promise<DnsCheckDto> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const domain = await this.applications.domains.findOne({
      where: { id: params.domainId, applicationId: app.id },
    });
    if (!domain) throw new NotFoundException('Domain not found');
    return this.service.execute(app, domain.host);
  }
}
