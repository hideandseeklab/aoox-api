import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DockerNetworkDto, DockerTargetQueryDto } from '../docker-manager.dto';
import { ListNetworksService } from './list-networks.service';

@Controller('docker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListNetworksController {
  constructor(private readonly service: ListNetworksService) {}

  @Get('networks')
  list(@Query() q: DockerTargetQueryDto): Promise<DockerNetworkDto[]> {
    return this.service.execute(q.serverId);
  }
}
