import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** What an API token is allowed to do; sessions get the unrestricted value. */
export interface TokenScope {
  /** Refuse anything that changes state. */
  readOnly: boolean;
  /** Projects the token may touch; null = whatever the user may see. */
  projectIds: string[] | null;
}

export const FULL_SCOPE: TokenScope = { readOnly: false, projectIds: null };

export interface RequestContext {
  method: string;
  path: string;
  /**
   * Set by JwtAuthGuard for every authenticated request — always, so a
   * missing scope means "no request context" (background work), never
   * "unrestricted by accident".
   */
  tokenScope?: TokenScope;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The HTTP request being handled, or undefined in background work (schedulers, runners, gateways). */
export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * POSTs that only read. A ticket is the browser's way to open a websocket
 * it cannot authenticate with a header, so it must stay available to
 * viewers; everything else with a body changes something.
 */
const READ_ONLY_POSTS = [/\/log-ticket$/];

/** Runs `fn` inside a request context; used by the middleware and by tests. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Records the scope of the credential this request authenticated with. */
export function setTokenScope(scope: TokenScope): void {
  const ctx = storage.getStore();
  if (ctx) ctx.tokenScope = scope;
}

/** Scope of the current request, or undefined outside one (background work). */
export function currentTokenScope(): TokenScope | undefined {
  return storage.getStore()?.tokenScope;
}

/** Whether the current request changes state (used for the viewer role). */
export function isWriteRequest(ctx = currentRequest()): boolean {
  if (!ctx) return false; // no request: background work, never restricted
  if (['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) return false;
  if (
    ctx.method === 'POST' &&
    READ_ONLY_POSTS.some((re) => re.test(ctx.path))
  ) {
    return false;
  }
  return true;
}

/**
 * Makes the current request visible to services deep in the call tree
 * (ProjectAccessService) without threading it through every signature.
 * Node's AsyncLocalStorage keeps the store across the whole async handler.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    // `req.path` is relative to the middleware's mount point; the original
    // URL is the one that matches routes like `/applications/:id/log-ticket`.
    const path = (req.originalUrl || req.url).split('?')[0];
    storage.run({ method: req.method, path }, () => next());
  }
}
