import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  ApiTokenService,
  looksLikeApiToken,
} from '../api-token/api-token.service';
import { THROTTLE_BY_IP_KEY } from './throttle-by-ip.decorator';

const BY_IP = '__throttleByIp';

/**
 * Global rate limiter keyed on the authenticated identity, falling back to
 * the client IP.
 *
 * Why not just the IP: people behind one NAT or one reverse proxy share an
 * address, so one busy user used to lock out everyone else on it.
 *
 * Guard order: global APP_GUARDs run before controller-level guards, so
 * `JwtAuthGuard` has not set `req.user` yet. The identity is therefore derived
 * here from verified credentials only:
 *  - session JWT: signature and expiry verified with JwtService, scope-less
 *    tokens only (challenge and ticket tokens are not sessions) -> `user:<sub>`;
 *  - API token (`aoox_…`): resolved to its owner (cached briefly) ->
 *    `user:<ownerId>`, the same key as that user's sessions, so a user cannot
 *    multiply the quota by minting many tokens. Unknown token -> IP;
 *  - anything else, including a forged or expired JWT -> IP, so nobody can
 *    pick another person's bucket.
 * Routes marked `@ThrottleByIp()` always use the IP.
 */
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tokens: ApiTokenService,
  ) {
    super(options, storage, reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    if (
      this.reflector.getAllAndOverride<boolean>(THROTTLE_BY_IP_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      req[BY_IP] = true;
    }
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = await super.getTracker(req);
    if (req[BY_IP]) return ip;
    const headers = req.headers as Record<string, unknown> | undefined;
    const header = headers?.authorization;
    const bearer =
      typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : '';
    if (!bearer) return ip;
    try {
      if (looksLikeApiToken(bearer)) {
        const owner = await this.tokens.ownerIdOf(bearer);
        return owner ? `user:${owner}` : ip;
      }
      const payload = this.jwt.verify<{ sub?: unknown; scope?: unknown }>(
        bearer,
      );
      if (payload.scope || typeof payload.sub !== 'string' || !payload.sub) {
        return ip;
      }
      return `user:${payload.sub}`;
    } catch {
      return ip;
    }
  }
}
