import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  InstanceUpdateProgress,
  InstanceUpdateService,
} from './instance-update.service';

/**
 * Separate from `GET /instance/update` (which also fetches both remote
 * digests from the registry) so the web UI's poll-until-restarted loop,
 * ticking every few seconds for up to several minutes, doesn't hammer
 * Docker Hub the whole time.
 */
@Controller('instance/update')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class GetInstanceUpdateProgressController {
  constructor(private readonly service: InstanceUpdateService) {}

  @Get('progress')
  ping(): Promise<InstanceUpdateProgress> {
    return this.service.pingApplyStatus();
  }
}
