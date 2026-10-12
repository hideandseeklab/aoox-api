import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { DomainDnsService } from '../domain-dns.service';
import { DomainDto, toDomainDto } from '../domain-dto';
import { ApplicationParamsDto } from '../get-application/get-application.dto';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListDomainsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly dns: DomainDnsService,
  ) {}

  @Get(':id/domains')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<DomainDto[]> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const rows = await this.applications.domains.find({
      where: { applicationId: app.id },
      relations: { certificate: true },
      order: { createdAt: 'ASC' },
    });
    const names = new Map<string, string | null>();
    for (const id of new Set(rows.map((d) => d.dnsConnectionId))) {
      if (id) names.set(id, await this.dns.connectionName(id));
    }
    return rows.map((d) =>
      toDomainDto(
        d,
        d.certificate?.name ?? null,
        d.dnsConnectionId ? (names.get(d.dnsConnectionId) ?? null) : null,
      ),
    );
  }
}
