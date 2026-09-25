import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InvitationService } from '../invitation.service';
import {
  InvitationPreviewDto,
  InvitationTokenParamsDto,
} from './get-invitation.dto';

/** Public: lets the accept page show who the invitation is for. */
@Controller('invitations')
export class GetInvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('by-token/:token')
  async get(
    @Param() params: InvitationTokenParamsDto,
  ): Promise<InvitationPreviewDto> {
    const i = await this.invitations.findPendingByToken(params.token);
    if (!i) throw new NotFoundException('Invitation not found or expired');
    return { email: i.email, role: i.role, expiresAt: i.expiresAt };
  }
}
