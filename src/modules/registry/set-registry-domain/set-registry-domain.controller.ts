import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { RegistryDto } from '../registry.service';
import { SetRegistryDomainDto } from './set-registry-domain.dto';
import { SetRegistryDomainService } from './set-registry-domain.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class SetRegistryDomainController {
  constructor(private readonly service: SetRegistryDomainService) {}

  @Patch(':id/domain')
  execute(
    @Param('id') id: string,
    @Body() dto: SetRegistryDomainDto,
  ): Promise<RegistryDto> {
    return this.service.execute(id, dto);
  }
}
