import { isIP } from 'node:net';

/**
 * Hops trusted by default: loopback, link-local and private (RFC 1918 / ULA)
 * addresses. That covers Traefik and the web container on the docker network,
 * but never a public address, so a client reaching the API directly from the
 * internet cannot choose its own IP with `X-Forwarded-For`.
 */
export const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';

const PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

export type TrustProxySetting = boolean | number | string;

function validEntry(entry: string): boolean {
  if (PRESETS.has(entry)) return true;
  const [addr, prefix, ...rest] = entry.split('/');
  const family = isIP(addr);
  if (!family || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parses `TRUST_PROXY` into the value for Express `trust proxy`.
 *
 * - empty / unset: the private-network preset ({@link DEFAULT_TRUST_PROXY})
 * - `true` / `false`: trust every hop / none (`false` and `0` ignore the header)
 * - a number: trust that many hops from the socket
 * - otherwise a comma list of IPs, CIDRs or the presets
 *   `loopback`, `linklocal`, `uniquelocal`
 *
 * Throws on anything else, so a typo fails at boot instead of silently
 * trusting or ignoring the wrong hops.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim() || DEFAULT_TRUST_PROXY;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops === 0 ? false : hops;
  }
  const entries = value.split(',').map((entry) => entry.trim().toLowerCase());
  const bad = entries.find((entry) => !validEntry(entry));
  if (bad !== undefined) {
    throw new Error(
      `TRUST_PROXY: "${bad}" is not an IP, a CIDR range, a hop count or one of loopback, linklocal, uniquelocal`,
    );
  }
  return entries.join(', ');
}
