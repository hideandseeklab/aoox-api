import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { AcceptInvitationController } from './accept-invitation/accept-invitation.controller';
import { AcceptInvitationService } from './accept-invitation/accept-invitation.service';
import { CreateInvitationController } from './create-invitation/create-invitation.controller';
import { CreateInvitationService } from './create-invitation/create-invitation.service';
import { GetInvitationController } from './get-invitation/get-invitation.controller';
import { Invitation } from './invitation.entity';
import { InvitationService } from './invitation.service';
import { ListInvitationsController } from './list-invitations/list-invitations.controller';
import { RevokeInvitationController } from './revoke-invitation/revoke-invitation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Invitation]), AuthModule, UserModule],
  controllers: [
    // Static routes before ':id'.
    AcceptInvitationController,
    GetInvitationController,
    CreateInvitationController,
    ListInvitationsController,
    RevokeInvitationController,
  ],
  providers: [
    InvitationService,
    CreateInvitationService,
    AcceptInvitationService,
  ],
})
export class InvitationModule {}
