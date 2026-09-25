import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { verifyPassword } from '../../user/password.util';
import { UserService } from '../../user/user.service';
import { JwtPayload } from '../jwt.strategy';
import { TwoFactorService } from '../two-factor/two-factor.service';
import {
  SignInDto,
  SignInResponseDto,
  SignInTwoFactorDto,
  TwoFactorRequiredDto,
} from './sign-in.dto';
import { User } from '../../user/user.entity';

@Injectable()
export class SignInService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditLogService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async execute(
    dto: SignInDto,
    ip?: string,
  ): Promise<SignInResponseDto | TwoFactorRequiredDto> {
    const user = await this.userService.findByEmailWithPassword(dto.email);
    const valid =
      user && (await verifyPassword(dto.password, user.passwordHash));
    // Both outcomes are audited: failed attempts against a known email are
    // the signal for a brute force; the interceptor skips this route.
    this.audit.record({
      actorId: valid ? user.id : null,
      actorEmail: dto.email,
      via: 'anonymous',
      action: 'POST /auth/sign-in',
      method: 'POST',
      path: '/auth/sign-in',
      status: valid ? 200 : 401,
      ip,
    });
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.totpEnabled) {
      // First factor done; the challenge token only unlocks the second step.
      const challengeToken = await this.jwtService.signAsync(
        { sub: user.id, scope: '2fa' },
        { expiresIn: '5m' },
      );
      return { requiresTwoFactor: true, challengeToken };
    }
    return this.issue(user);
  }

  /** Second step: TOTP or backup code against the challenge token. */
  async executeTwoFactor(
    dto: SignInTwoFactorDto,
    ip?: string,
  ): Promise<SignInResponseDto> {
    let sub: string;
    try {
      const claims = await this.jwtService.verifyAsync<{
        sub: string;
        scope?: string;
      }>(dto.challengeToken);
      if (claims.scope !== '2fa') throw new Error('wrong scope');
      sub = claims.sub;
    } catch {
      throw new UnauthorizedException('Sign in again');
    }
    const user = await this.userService.findByIdWithSecrets(sub);
    const ok = !!user && (await this.twoFactor.verifyChallenge(user, dto.code));
    this.audit.record({
      actorId: user?.id ?? null,
      actorEmail: user?.email ?? null,
      via: 'anonymous',
      action: 'POST /auth/sign-in/2fa',
      method: 'POST',
      path: '/auth/sign-in/2fa',
      status: ok ? 200 : 401,
      ip,
    });
    if (!ok) throw new UnauthorizedException('Invalid code');
    return this.issue(user);
  }

  private async issue(user: User): Promise<SignInResponseDto> {
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
