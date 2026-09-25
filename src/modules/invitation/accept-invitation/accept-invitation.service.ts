import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { SignInResponseDto } from '../../auth/sign-in/sign-in.dto';
import { hashPassword } from '../../user/password.util';
import { User } from '../../user/user.entity';
import { Invitation } from '../invitation.entity';
import { InvitationService } from '../invitation.service';
import { AcceptInvitationDto } from './accept-invitation.dto';

/**
 * Creates the invited account and signs it in. The invitation's email and
 * role are authoritative — the form only supplies name and password. Runs
 * in a transaction so one link cannot create two accounts.
 */
@Injectable()
export class AcceptInvitationService {
  constructor(
    private readonly invitations: InvitationService,
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
  ) {}

  async execute(dto: AcceptInvitationDto): Promise<SignInResponseDto> {
    const invitation = await this.invitations.findPendingByToken(dto.token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found or expired');
    }
    const passwordHash = await hashPassword(dto.password);

    const user = await this.dataSource.transaction(async (em) => {
      const claimed = await em
        .createQueryBuilder()
        .update(Invitation)
        .set({ acceptedAt: () => 'now()' })
        .where('id = :id AND accepted_at IS NULL', { id: invitation.id })
        .execute();
      if (!claimed.affected) {
        throw new ConflictException('Invitation was already used');
      }
      if (await em.findOne(User, { where: { email: invitation.email } })) {
        throw new ConflictException('A user with this email already exists');
      }
      return em.save(
        em.create(User, {
          email: invitation.email,
          passwordHash,
          name: dto.name?.trim() || null,
          role: invitation.role,
        }),
      );
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
}
