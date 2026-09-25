import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { InvitationDto } from '../invitation.service';
import { InvitationService } from '../invitation.service';

@Controller('invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class ListInvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  /** Newest first; accepted ones stay as history. */
  @Get()
  async list(): Promise<InvitationDto[]> {
    const rows = await this.invitations.repo.find({
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.invitations.toDto(r));
  }
}
