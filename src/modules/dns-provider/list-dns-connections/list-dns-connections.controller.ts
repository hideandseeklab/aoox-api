import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { DnsConnectionDto, DnsProviderService } from '../dns-provider.service';

/** Every member can list (names for the domain dropdown); no tokens in the DTO. */
@Controller('dns-connections')
@UseGuards(JwtAuthGuard)
export class ListDnsConnectionsController {
  constructor(private readonly dns: DnsProviderService) {}

  @Get()
  async list(): Promise<DnsConnectionDto[]> {
    const rows = await this.dns.repo.find({ order: { createdAt: 'ASC' } });
    return rows.map((r) => this.dns.toDto(r));
  }
}
