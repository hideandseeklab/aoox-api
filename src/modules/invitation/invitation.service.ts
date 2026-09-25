import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { Invitation } from './invitation.entity';

/** Links stay valid this long; expired rows are ignored and can be revoked. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Public shape; the token is only ever returned once, at creation. */
export interface InvitationDto {
  id: string;
  email: string;
  role: Invitation['role'];
  invitedById: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  /** Derived: not accepted and not expired. */
  pending: boolean;
}

@Injectable()
export class InvitationService {
  constructor(
    @InjectRepository(Invitation)
    readonly repo: Repository<Invitation>,
    private readonly config: ConfigService,
  ) {}

  toDto(i: Invitation): InvitationDto {
    return {
      id: i.id,
      email: i.email,
      role: i.role,
      invitedById: i.invitedById,
      expiresAt: i.expiresAt,
      acceptedAt: i.acceptedAt,
      createdAt: i.createdAt,
      pending: !i.acceptedAt && i.expiresAt.getTime() > Date.now(),
    };
  }

  /** 32 random bytes, base64url: the part of the link the user pastes back. */
  static generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Where the web app accepts invitations (needs WEB_ORIGIN to build a link). */
  acceptUrl(token: string): string | null {
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    return origin ? `${origin}/invite/${token}` : null;
  }

  async findOrFail(id: string): Promise<Invitation> {
    const i = await this.repo.findOne({ where: { id } });
    if (!i) throw new NotFoundException('Invitation not found');
    return i;
  }

  /**
   * Looks an invitation up by its token. The hash is a unique index, so this
   * is a single lookup; comparing hashes of a random 256-bit token is not
   * timing-sensitive the way a password compare would be.
   */
  findPendingByToken(token: string): Promise<Invitation | null> {
    return this.repo
      .createQueryBuilder('i')
      .addSelect('i.tokenHash')
      .where('i.token_hash = :hash', {
        hash: InvitationService.hashToken(token),
      })
      .andWhere('i.accepted_at IS NULL')
      .andWhere('i.expires_at > now()')
      .getOne();
  }
}
