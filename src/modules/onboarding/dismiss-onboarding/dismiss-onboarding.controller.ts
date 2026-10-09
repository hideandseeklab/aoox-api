import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { OnboardingService } from '../onboarding.service';

@Controller('onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class DismissOnboardingController {
  constructor(private readonly service: OnboardingService) {}

  /** "Sembunyikan": persists per user and does not come back. */
  @Post('dismiss')
  @HttpCode(204)
  async dismiss(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.service.dismiss(user.sub);
  }
}
