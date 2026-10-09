import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { OnboardingDto } from '../onboarding-steps';
import { OnboardingService } from '../onboarding.service';

/** The dashboard checklist: one call, computed from real state. Others get `visible: false`. */
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class GetOnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Get()
  get(@CurrentUser() user: JwtPayload): Promise<OnboardingDto> {
    return this.service.view(user.sub, user.role);
  }
}
