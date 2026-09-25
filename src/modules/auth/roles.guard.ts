import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../user/user.entity';
import type { JwtPayload } from './jwt.strategy';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!roles?.length) return true;
    const { user } = ctx
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    return !!user && roles.includes(user.role as UserRole);
  }
}
