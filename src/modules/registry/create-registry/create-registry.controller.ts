import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { RegistryDto } from '../registry.service';
import { CreateRegistryDto } from './create-registry.dto';
import { CreateRegistryService } from './create-registry.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateRegistryController {
  constructor(private readonly service: CreateRegistryService) {}

  @Post()
  create(@Body() dto: CreateRegistryDto): Promise<RegistryDto> {
    return this.service.execute(dto);
  }
}
