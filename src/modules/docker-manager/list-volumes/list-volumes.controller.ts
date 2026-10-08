import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DockerTargetQueryDto, DockerVolumeDto } from '../docker-manager.dto';
import { ListVolumesService } from './list-volumes.service';

@Controller('docker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListVolumesController {
  constructor(private readonly service: ListVolumesService) {}

  // `/system/df` walks every volume; keep it from being hammered.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('volumes')
  list(@Query() q: DockerTargetQueryDto): Promise<DockerVolumeDto[]> {
    return this.service.execute(q.serverId);
  }
}
