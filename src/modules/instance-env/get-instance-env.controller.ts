import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InstanceEnvService } from './instance-env.service';
import type { InstanceEnvStatus } from './instance-env.service';

@Controller('instance/env')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class GetInstanceEnvController {
  constructor(private readonly instanceEnv: InstanceEnvService) {}

  @Get()
  get(): InstanceEnvStatus {
    return this.instanceEnv.status();
  }
}
