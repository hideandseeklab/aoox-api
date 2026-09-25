import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SwarmService } from '../swarm.service';

@Controller('swarm')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class LeaveSwarmController {
  constructor(private readonly swarm: SwarmService) {}

  /** Force-leaves the swarm; refused while apps still run as services (409). */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(): Promise<void> {
    return this.swarm.leave();
  }
}
