import {
  Controller,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DockerTargetQueryDto } from '../docker-manager.dto';
import { ContainerActionService } from './container-action.service';

@Controller('docker/containers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class ContainerActionController {
  constructor(private readonly service: ContainerActionService) {}

  @Post(':id/start')
  @HttpCode(204)
  start(@Param('id') id: string, @Query() q: DockerTargetQueryDto) {
    return this.service.execute(id, 'start', q.serverId);
  }

  @Post(':id/stop')
  @HttpCode(204)
  stop(@Param('id') id: string, @Query() q: DockerTargetQueryDto) {
    return this.service.execute(id, 'stop', q.serverId);
  }

  @Post(':id/restart')
  @HttpCode(204)
  restart(@Param('id') id: string, @Query() q: DockerTargetQueryDto) {
    return this.service.execute(id, 'restart', q.serverId);
  }
}
