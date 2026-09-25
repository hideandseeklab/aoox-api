import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  ListRepositoriesParamsDto,
  RepositoryDto,
} from './list-repositories.dto';
import { ListRepositoriesService } from './list-repositories.service';

@Controller('registries')
@UseGuards(JwtAuthGuard)
export class ListRepositoriesController {
  constructor(private readonly service: ListRepositoriesService) {}

  @Get(':id/repositories')
  list(@Param() params: ListRepositoriesParamsDto): Promise<RepositoryDto[]> {
    return this.service.execute(params.id);
  }
}
