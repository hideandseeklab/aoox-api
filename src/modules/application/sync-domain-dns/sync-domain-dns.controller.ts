import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { DeleteDomainParamsDto } from '../delete-domain/delete-domain.dto';
import { DomainDnsService } from '../domain-dns.service';
import { DomainDto, toDomainDto } from '../domain-dto';

export class SyncDomainDnsDto {
  /** Replace an existing record that has different content. */
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class SyncDomainDnsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly dns: DomainDnsService,
  ) {}

  /** Runs the record sync again (retry after fixing the zone/token, or with overwrite). Developer+. */
  @Post(':id/domains/:domainId/dns/sync')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async sync(
    @CurrentUser() user: JwtPayload,
    @Param() params: DeleteDomainParamsDto,
    @Body() dto: SyncDomainDnsDto,
  ): Promise<DomainDto> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const domain = await this.applications.domains.findOne({
      where: { id: params.domainId, applicationId: app.id },
      relations: { certificate: true },
    });
    if (!domain) throw new NotFoundException('Domain not found');
    if (!domain.dnsConnectionId) {
      throw new BadRequestException(
        'This domain has no DNS connection; attach one first',
      );
    }
    await this.dns.sync(app, domain, dto.overwrite === true);
    return toDomainDto(
      domain,
      domain.certificate?.name ?? null,
      await this.dns.connectionName(domain.dnsConnectionId),
    );
  }
}
