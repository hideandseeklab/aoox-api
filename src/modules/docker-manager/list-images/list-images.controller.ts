import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DockerImageDto, DockerTargetQueryDto } from '../docker-manager.dto';
import { ListImagesService } from './list-images.service';

@Controller('docker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListImagesController {
  constructor(private readonly service: ListImagesService) {}

  @Get('images')
  list(@Query() q: DockerTargetQueryDto): Promise<DockerImageDto[]> {
    return this.service.execute(q.serverId);
  }
}
