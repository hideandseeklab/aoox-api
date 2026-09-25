import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../user/user.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * The token proves identity; the role comes from the database so a
   * demotion or deletion takes effect on the next request, not when the
   * 7-day token expires. One indexed lookup per request.
   */
  async validate(
    payload: JwtPayload & { scope?: string },
  ): Promise<JwtPayload> {
    // Single-purpose tokens signed with the same secret (2FA challenge,
    // terminal/log tickets) carry a `scope`; only unscoped tokens are sessions.
    if (payload.scope) throw new UnauthorizedException('Not a session token');
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');
    return { sub: user.id, email: user.email, role: user.role };
  }
}
