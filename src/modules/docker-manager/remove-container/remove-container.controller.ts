import {
  Controller,
  Delete,
  HttpCode,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { RemoveContainerQueryDto } from '../docker-manager.dto';
import { RemoveContainerService } from './remove-container.service';

@Controller('docker')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RemoveContainerController {
  constructor(private readonly service: RemoveContainerService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Delete('containers/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Query() q: RemoveContainerQueryDto) {
    return this.service.execute(id, q.force === true, q.serverId);
  }
}
