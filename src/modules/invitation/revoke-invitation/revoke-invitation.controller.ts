import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { InvitationService } from '../invitation.service';
import { RevokeInvitationParamsDto } from './revoke-invitation.dto';

/** Deletes the row; the link stops working immediately. */
@Controller('invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class RevokeInvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param() params: RevokeInvitationParamsDto): Promise<void> {
    const i = await this.invitations.findOrFail(params.id);
    await this.invitations.repo.remove(i);
  }
}
