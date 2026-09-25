import { isIP } from 'net';

const GITHUB_META_URL = 'https://api.github.com/meta';
const CACHE_MS = 60 * 60_000;

let cache: { ranges: string[]; at: number } | null = null;

/**
 * GitHub's published webhook source ranges ("hooks" in the meta API; docs:
 * "About GitHub's IP addresses"). Cached for an hour; on a fetch failure the
 * last good list is kept (an empty list on first boot means "cannot verify
 * yet", not "reject everything" — see `isGithubHookIp`).
 */
export async function githubHookRanges(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ranges;
  try {
    const res = await fetch(GITHUB_META_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { hooks?: unknown };
    if (!res.ok || !Array.isArray(body.hooks)) {
      throw new Error('unexpected reply from api.github.com/meta');
    }
    cache = { ranges: body.hooks as string[], at: Date.now() };
  } catch {
    // Keep serving the stale cache (or the empty starting state) rather
    // than let a GitHub API hiccup turn into a deploy outage.
  }
  return cache?.ranges ?? [];
}

/** `::ffff:1.2.3.4` (a dual-stack socket's view of an IPv4 peer) -> `1.2.3.4`. */
function normalize(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip.trim());
  return m ? m[1] : ip.trim();
}

/** IPv4/IPv6 CIDR containment. Pure, unit-tested; never throws on bad input. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf('/');
  if (slash < 0) return false;
  const range = cidr.slice(0, slash);
  const bits = Number(cidr.slice(slash + 1));
  const a = normalize(ip);
  const version = isIP(a);
  if (version === 0 || version !== isIP(range) || !Number.isFinite(bits)) {
    return false;
  }
  const ipBytes = version === 4 ? ipv4ToBytes(a) : ipv6ToBytes(a);
  const rangeBytes = version === 4 ? ipv4ToBytes(range) : ipv6ToBytes(range);
  if (!ipBytes || !rangeBytes || bits < 0 || bits > ipBytes.length * 8) {
    return false;
  }
  let remaining = bits;
  for (let i = 0; i < ipBytes.length; i++) {
    const take = Math.min(8, Math.max(0, remaining));
    remaining -= take;
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff;
    if ((ipBytes[i] & mask) !== (rangeBytes[i] & mask)) return false;
  }
  return true;
}

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)
    ? parts
    : null;
}

function ipv6ToBytes(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let hextets: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    hextets = [...head, ...Array<string>(missing).fill('0'), ...tail];
  } else {
    hextets = head;
  }
  if (hextets.length !== 8) return null;
  const bytes: number[] = [];
  for (const h of hextets) {
    if (!/^[0-9a-f]{0,4}$/i.test(h)) return null;
    const n = parseInt(h || '0', 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

/** Whether `ip` falls in any of GitHub's published webhook source ranges. */
export function isGithubHookIp(
  ip: string | undefined,
  ranges: string[],
): boolean {
  if (!ip) return false;
  return ranges.some((cidr) => ipInCidr(ip, cidr));
}
