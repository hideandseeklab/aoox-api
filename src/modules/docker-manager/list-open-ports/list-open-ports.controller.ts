import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { DockerTargetQueryDto, OpenPortDto } from '../docker-manager.dto';
import { ListOpenPortsService } from './list-open-ports.service';

@Controller('docker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListOpenPortsController {
  constructor(private readonly service: ListOpenPortsService) {}

  /** Every port a container publishes on the daemon, with who owns it and who can reach it. Read only. */
  @Get('open-ports')
  list(@Query() q: DockerTargetQueryDto): Promise<OpenPortDto[]> {
    return this.service.execute(q.serverId);
  }
}
