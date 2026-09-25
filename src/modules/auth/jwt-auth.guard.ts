import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  ApiTokenService,
  looksLikeApiToken,
} from '../api-token/api-token.service';
import { FULL_SCOPE, isWriteRequest, setTokenScope } from './request-context';
import { ROLES_KEY } from './roles.decorator';
import type { JwtPayload } from './jwt.strategy';

/**
 * Bearer auth for both session JWTs and personal access tokens (`aoox_…`).
 * A token request gets the same `req.user` shape as a JWT one, so guards,
 * decorators and services do not care which was used — except for the
 * token's scope, which is put in the request context here (the only place
 * that decides it) and read again by ProjectAccessService.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly tokens: ApiTokenService,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload & { tokenId?: string } }>();
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (looksLikeApiToken(bearer)) {
      const resolved = await this.tokens.resolve(bearer);
      if (!resolved) {
        throw new UnauthorizedException('Invalid or expired API token');
      }
      const { readOnly, projectIds } = resolved.token;
      if (readOnly && isWriteRequest()) {
        throw new ForbiddenException('This API token is read-only');
      }
      // A project-scoped token has no business on platform-wide routes
      // (registry, servers, proxy, swarm, notifications, maintenance…),
      // which are exactly the ones carrying @Roles.
      if (
        projectIds &&
        this.reflector.getAllAndOverride(ROLES_KEY, [
          ctx.getHandler(),
          ctx.getClass(),
        ])
      ) {
        throw new ForbiddenException(
          'This API token is limited to projects and cannot use platform settings',
        );
      }
      setTokenScope({ readOnly, projectIds });
      req.user = {
        sub: resolved.user.id,
        email: resolved.user.email,
        role: resolved.user.role,
        tokenId: resolved.token.id,
      };
      return true;
    }
    const ok = (await super.canActivate(ctx)) as boolean;
    // Sessions are unrestricted; record it so a missing scope can only mean
    // "not an HTTP request" (schedulers, runners), never a wiring mistake.
    if (ok) setTokenScope(FULL_SCOPE);
    return ok;
  }
}
