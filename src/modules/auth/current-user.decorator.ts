import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { JwtPayload } from './jwt.strategy';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    return req.user;
  },
);
