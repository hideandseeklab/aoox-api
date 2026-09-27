import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InstanceEnvService } from './instance-env.service';
import { UpdateInstanceEnvDto } from './update-instance-env.dto';

@Controller('instance/env')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class UpdateInstanceEnvController {
  constructor(private readonly instanceEnv: InstanceEnvService) {}

  // Can recreate the panel's own api container — not something to brute-force.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Patch()
  @HttpCode(HttpStatus.ACCEPTED)
  update(@Body() dto: UpdateInstanceEnvDto): void {
    this.instanceEnv.update(dto);
  }
}
