import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  CreateInvitationDto,
  CreateInvitationResponseDto,
} from './create-invitation.dto';
import { CreateInvitationService } from './create-invitation.service';

@Controller('invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateInvitationController {
  constructor(private readonly service: CreateInvitationService) {}

  @Post()
  create(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CreateInvitationDto,
  ): Promise<CreateInvitationResponseDto> {
    return this.service.execute(actor, dto);
  }
}
