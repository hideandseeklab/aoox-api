import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SwarmService, SwarmStatus } from '../swarm.service';

@Controller('swarm')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class SwarmStatusController {
  constructor(private readonly swarm: SwarmService) {}

  /** Join tokens are as sensitive as a root shell on the cluster: owner only. */
  @Get()
  async status(@CurrentUser() user: JwtPayload): Promise<SwarmStatus> {
    const s = await this.swarm.status();
    return user.role === 'owner' ? s : { ...s, joinTokens: null };
  }
}
