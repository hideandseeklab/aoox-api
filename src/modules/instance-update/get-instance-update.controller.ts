import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  InstanceUpdateService,
  InstanceUpdateStatus,
} from './instance-update.service';

@Controller('instance/update')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class GetInstanceUpdateController {
  constructor(private readonly service: InstanceUpdateService) {}

  @Get()
  check(): Promise<InstanceUpdateStatus> {
    return this.service.check();
  }
}
