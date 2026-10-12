import {
  Body,
  ConflictException,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DnsConnectionDto, DnsProviderService } from '../dns-provider.service';
import { CreateDnsConnectionDto } from './create-dns-connection.dto';

@Controller('dns-connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateDnsConnectionController {
  constructor(private readonly dns: DnsProviderService) {}

  @Post()
  async create(@Body() dto: CreateDnsConnectionDto): Promise<DnsConnectionDto> {
    const name = dto.name.trim();
    if (await this.dns.repo.exists({ where: { name } })) {
      throw new ConflictException(
        `A DNS connection named "${name}" already exists`,
      );
    }
    const saved = await this.dns.repo.save(
      this.dns.repo.create({
        name,
        provider: 'cloudflare',
        apiTokenEncrypted: this.dns.encrypt(dto.apiToken.trim()),
        accountId: dto.accountId?.trim().toLowerCase() || null,
      }),
    );
    return this.dns.toDto(saved);
  }
}
