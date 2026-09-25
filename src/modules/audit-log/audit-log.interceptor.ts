import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuditLogService } from './audit-log.service';
import { redactBody } from './redact';

/** Sign-in/setup are logged by their services (they know success vs. bad password). */
const SKIP = new Set(['POST /auth/sign-in', 'POST /auth/setup']);

/**
 * Global interceptor: every non-GET request that reached a handler is
 * logged with its final status (2xx or the thrown HttpException's code).
 * GET is skipped — reads are not what an audit trail is for, and logging
 * them would drown the log in polling.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditLogService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload & { tokenId?: string } }>();
    // Express types `route` as any; it carries the matched template path.
    const template = (req as { route?: { path?: unknown } }).route?.path;
    if (
      req.method === 'GET' ||
      req.method === 'HEAD' ||
      req.method === 'OPTIONS'
    ) {
      return next.handle();
    }
    const action = `${req.method} ${typeof template === 'string' ? template : req.path}`;
    if (SKIP.has(action)) return next.handle();
    const res = ctx.switchToHttp().getResponse<Response>();
    const record = (status: number) =>
      this.audit.record({
        actorId: req.user?.sub ?? null,
        actorEmail: req.user?.email ?? null,
        via: req.user
          ? req.user.tokenId
            ? 'token'
            : 'session'
          : action.startsWith('POST /webhooks/')
            ? 'webhook'
            : 'anonymous',
        tokenId: req.user?.tokenId ?? null,
        action,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        params: req.params as Record<string, string>,
        body: redactBody(req.body),
        status,
        ip: req.ip ?? null,
      });
    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        error: (err: unknown) =>
          record(
            typeof (err as { getStatus?: () => number }).getStatus ===
              'function'
              ? (err as { getStatus: () => number }).getStatus()
              : 500,
          ),
      }),
    );
  }
}
