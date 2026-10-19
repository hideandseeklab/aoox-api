import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  GetRegistryCredentialsParamsDto,
  RegistryCredentialsDto,
} from './get-registry-credentials.dto';
import { GetRegistryCredentialsService } from './get-registry-credentials.service';

/** Password kept off GET /registries so the list never carries it (same as database-credentials). */
@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class GetRegistryCredentialsController {
  constructor(private readonly service: GetRegistryCredentialsService) {}

  /** For the CLI (`aoox deploy`). GETs are not written to the audit log. */
  @Get(':id/credentials')
  get(
    @Param() params: GetRegistryCredentialsParamsDto,
  ): Promise<RegistryCredentialsDto> {
    return this.service.execute(params.id);
  }

  /**
   * Same payload for the dashboard's "Show password". A POST so that the audit
   * log interceptor records who revealed the registry password (it skips GETs).
   * It also means read-only API tokens cannot use it, unlike the GET above.
   */
  @Post(':id/credentials/reveal')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reveal(
    @Param() params: GetRegistryCredentialsParamsDto,
  ): Promise<RegistryCredentialsDto> {
    return this.service.execute(params.id);
  }
}
