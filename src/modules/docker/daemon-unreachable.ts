import { BadGatewayException } from '@nestjs/common';

const CONNECT_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM']);

/**
 * Is this the raw Node error of failing to connect to a local socket or named
 * pipe (the Docker daemon is stopped, the socket is missing or not readable)?
 * A TCP error (database, remote host) carries a `port` and never matches, so a
 * PostgreSQL outage is not reported as a Docker one. Pure.
 */
export function isDaemonConnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & {
    code?: unknown;
    syscall?: unknown;
    address?: unknown;
    port?: unknown;
  };
  return (
    typeof e.code === 'string' &&
    CONNECT_CODES.has(e.code) &&
    e.syscall === 'connect' &&
    typeof e.address === 'string' &&
    e.port === undefined
  );
}

/** Short, secret-free reason for the notice shown to the user (max 160 chars). */
export function daemonUnreachableReason(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return reason.length > 160 ? `${reason.slice(0, 160)}...` : reason;
}

/** The 502 a request answers when the daemon cannot be reached. */
export function daemonUnreachableException(err: unknown): BadGatewayException {
  return new BadGatewayException(
    `The Docker daemon is not reachable (${daemonUnreachableReason(err)}).`,
  );
}
