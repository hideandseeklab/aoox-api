import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InstanceUpdateService } from './instance-update.service';

@Controller('instance/update')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class ApplyInstanceUpdateController {
  constructor(private readonly service: InstanceUpdateService) {}

  // Recreates the panel's own containers — not something to brute-force.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('apply')
  @HttpCode(HttpStatus.ACCEPTED)
  apply(): Promise<void> {
    return this.service.apply();
  }
}
