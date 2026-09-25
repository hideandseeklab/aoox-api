import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SignInResponseDto } from '../../auth/sign-in/sign-in.dto';
import { AcceptInvitationDto } from './accept-invitation.dto';
import { AcceptInvitationService } from './accept-invitation.service';

/** Public, like sign-in/setup: the token is the credential. */
@Controller('invitations')
export class AcceptInvitationController {
  constructor(private readonly service: AcceptInvitationService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept')
  accept(@Body() dto: AcceptInvitationDto): Promise<SignInResponseDto> {
    return this.service.execute(dto);
  }
}
