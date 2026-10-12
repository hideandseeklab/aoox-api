import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DnsConnectionParamsDto } from '../delete-dns-connection/delete-dns-connection.controller';
import {
  DnsConnectionTestResult,
  DnsProviderService,
} from '../dns-provider.service';

@Controller('dns-connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class TestDnsConnectionController {
  constructor(private readonly dns: DnsProviderService) {}

  /** Verifies the token and lists accessible zones; never echoes the token. */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  test(
    @Param() params: DnsConnectionParamsDto,
  ): Promise<DnsConnectionTestResult> {
    return this.dns.test(params.id);
  }
}
