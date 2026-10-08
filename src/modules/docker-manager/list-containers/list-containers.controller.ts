import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  DockerContainerDto,
  DockerTargetQueryDto,
} from '../docker-manager.dto';
import { ListContainersService } from './list-containers.service';

@Controller('docker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListContainersController {
  constructor(private readonly service: ListContainersService) {}

  @Get('containers')
  list(@Query() q: DockerTargetQueryDto): Promise<DockerContainerDto[]> {
    return this.service.execute(q.serverId);
  }
}
