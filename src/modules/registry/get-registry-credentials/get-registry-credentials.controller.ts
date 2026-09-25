import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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

  @Get(':id/credentials')
  get(
    @Param() params: GetRegistryCredentialsParamsDto,
  ): Promise<RegistryCredentialsDto> {
    return this.service.execute(params.id);
  }
}
