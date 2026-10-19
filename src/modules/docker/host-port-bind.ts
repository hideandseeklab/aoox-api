/**
 * Which host interface a published port listens on.
 *
 * Docker publishes `HostPort` on every interface (0.0.0.0 and ::) unless a
 * `HostIp` is given, and published ports bypass ufw/iptables rules of the
 * INPUT chain, so a database "published for my laptop" is open to the whole
 * internet. `loopback` binds 127.0.0.1 only (reach it with an SSH tunnel).
 */
export const HOST_PORT_BINDS = ['public', 'loopback'] as const;
export type HostPortBind = (typeof HOST_PORT_BINDS)[number];

export const LOOPBACK_IP = '127.0.0.1';

/** Anything unknown (null, undefined, a stale value) is the historical behavior: public. */
export function normalizeBind(bind: unknown): HostPortBind {
  return bind === 'loopback' ? 'loopback' : 'public';
}

/** One Docker `PortBindings` entry for a host port. */
export function hostPortBinding(
  hostPort: number,
  bind?: HostPortBind | null,
): { HostIp?: string; HostPort: string } {
  return normalizeBind(bind) === 'loopback'
    ? { HostIp: LOOPBACK_IP, HostPort: String(hostPort) }
    : { HostPort: String(hostPort) };
}

/** `HostIp` of an inspected binding -> bind mode (loopback IPs mean loopback). */
export function bindOfBinding(
  binding?: { HostIp?: string } | null,
): HostPortBind {
  const ip = binding?.HostIp;
  return ip === LOOPBACK_IP || ip === '::1' ? 'loopback' : 'public';
}

/** Left side of a compose short-syntax port: `127.0.0.1:` or empty. */
export function composeHostPrefix(bind?: HostPortBind | null): string {
  return normalizeBind(bind) === 'loopback' ? `${LOOPBACK_IP}:` : '';
}

/** A published `Ports[].IP` of a container summary: open to every interface? */
export function isPublicIp(ip: string | undefined | null): boolean {
  if (!ip) return true;
  return ip === '0.0.0.0' || ip === '::';
}

export function isLoopbackIp(ip: string | undefined | null): boolean {
  return !!ip && (ip === LOOPBACK_IP || ip === '::1' || ip.startsWith('127.'));
}
