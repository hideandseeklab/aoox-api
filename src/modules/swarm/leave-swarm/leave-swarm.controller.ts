import { Controller, Delete, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { LeaveSwarmResult, SwarmService } from '../swarm.service';

@Controller('swarm')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class LeaveSwarmController {
  constructor(private readonly swarm: SwarmService) {}

  /**
   * Force-leaves the swarm; refused while apps still run as services (409).
   * Answers 200 `{restartDockerRequired, notice}`: leaving breaks container
   * DNS until Docker is restarted on the host (moby/moby#45144).
   */
  @Delete()
  leave(): Promise<LeaveSwarmResult> {
    return this.swarm.leave();
  }
}
