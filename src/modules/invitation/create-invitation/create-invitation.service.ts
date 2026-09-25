import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { UserService } from '../../user/user.service';
import { INVITATION_TTL_MS, InvitationService } from '../invitation.service';
import {
  CreateInvitationDto,
  CreateInvitationResponseDto,
} from './create-invitation.dto';

@Injectable()
export class CreateInvitationService {
  constructor(
    private readonly invitations: InvitationService,
    private readonly users: UserService,
  ) {}

  async execute(
    actor: JwtPayload,
    dto: CreateInvitationDto,
  ): Promise<CreateInvitationResponseDto> {
    // Only an owner can hand out the owner role.
    if (dto.role === 'owner' && actor.role !== 'owner') {
      throw new ForbiddenException('Only an owner can invite another owner');
    }
    const email = dto.email.toLowerCase().trim();
    if (await this.users.repo.findOne({ where: { email } })) {
      throw new ConflictException('A user with this email already exists');
    }
    // Replace any pending invitation for the same address.
    await this.invitations.repo
      .createQueryBuilder()
      .delete()
      .where('email = :email AND accepted_at IS NULL', { email })
      .execute();

    const token = InvitationService.generateToken();
    const saved = await this.invitations.repo.save(
      this.invitations.repo.create({
        email,
        role: dto.role,
        tokenHash: InvitationService.hashToken(token),
        invitedById: actor.sub,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      }),
    );
    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      expiresAt: saved.expiresAt,
      token,
      acceptUrl: this.invitations.acceptUrl(token),
    };
  }
}
