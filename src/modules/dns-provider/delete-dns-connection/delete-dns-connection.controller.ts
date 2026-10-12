import {
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { Domain } from '../../application/domain.entity';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DnsProviderService } from '../dns-provider.service';
import { ProxyDnsBinding } from '../proxy-dns-binding.entity';

export class DnsConnectionParamsDto {
  @IsUUID()
  id: string;
}

@Controller('dns-connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteDnsConnectionController {
  constructor(
    private readonly dns: DnsProviderService,
    @InjectRepository(Domain) private readonly domains: Repository<Domain>,
    @InjectRepository(ProxyDnsBinding)
    private readonly bindings: Repository<ProxyDnsBinding>,
  ) {}

  /** Refused while a domain or a proxy still uses it (its records could no longer be cleaned up). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: DnsConnectionParamsDto): Promise<void> {
    const c = await this.dns.findOrFail(params.id);
    const used = await this.domains.find({
      where: { dnsConnectionId: c.id },
      select: { host: true },
      take: 5,
    });
    const proxies = await this.bindings.count({
      where: { connectionId: c.id },
    });
    if (used.length > 0 || proxies > 0) {
      const parts: string[] = [];
      if (used.length > 0) {
        parts.push(`domains: ${used.map((d) => d.host).join(', ')}`);
      }
      if (proxies > 0) {
        parts.push(
          `${proxies} proxy DNS-01 setting${proxies === 1 ? '' : 's'}`,
        );
      }
      throw new ConflictException(
        `"${c.name}" is still in use (${parts.join('; ')}). Detach it first.`,
      );
    }
    await this.dns.repo.remove(c);
  }
}
