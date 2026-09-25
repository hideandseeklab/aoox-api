import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RegistryDto } from '../registry.service';
import { ListRegistriesService } from './list-registries.service';

@Controller('registries')
@UseGuards(JwtAuthGuard)
export class ListRegistriesController {
  constructor(private readonly service: ListRegistriesService) {}

  @Get()
  list(): Promise<RegistryDto[]> {
    return this.service.execute();
  }
}
