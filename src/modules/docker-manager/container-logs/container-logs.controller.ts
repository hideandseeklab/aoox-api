import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  ContainerLogsQueryDto,
  DockerContainerLogsDto,
} from '../docker-manager.dto';
import { ContainerLogsService } from './container-logs.service';

@Controller('docker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ContainerLogsController {
  constructor(private readonly service: ContainerLogsService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('containers/:id/logs')
  logs(
    @Param('id') id: string,
    @Query() q: ContainerLogsQueryDto,
  ): Promise<DockerContainerLogsDto> {
    return this.service.execute(id, q.tail, q.serverId);
  }
}
