import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ResetRegistryPasswordResponseDto } from './reset-registry-password.dto';
import { ResetRegistryPasswordService } from './reset-registry-password.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class ResetRegistryPasswordController {
  constructor(private readonly service: ResetRegistryPasswordService) {}

  /** Static path: registered before the ':id' routes. */
  @Post('self-hosted/password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  reset(): Promise<ResetRegistryPasswordResponseDto> {
    return this.service.execute();
  }
}
