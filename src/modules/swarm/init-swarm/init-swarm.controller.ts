import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SwarmService, SwarmStatus } from '../swarm.service';
import { InitSwarmDto } from './init-swarm.dto';

@Controller('swarm')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class InitSwarmController {
  constructor(private readonly swarm: SwarmService) {}

  /** `docker swarm init` on the host daemon (+ the overlay network). */
  @Post('init')
  @HttpCode(HttpStatus.CREATED)
  init(@Body() dto: InitSwarmDto): Promise<SwarmStatus> {
    return this.swarm.init(dto.advertiseAddr?.trim() || undefined);
  }
}
