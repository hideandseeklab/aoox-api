/**
 * Does a certificate valid for `names` (DNS SANs, possibly wildcards) cover
 * `host`? Same rule browsers and Go (Traefik) apply: a wildcard stands for
 * exactly one label, only as the leftmost one — `*.example.com` covers
 * `a.example.com`, not `a.b.example.com` and not the apex `example.com`.
 * Case-insensitive; pure.
 */
export function domainMatches(host: string, names: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  for (const raw of names) {
    const n = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!n) continue;
    if (n === h) return true;
    if (n.startsWith('*.')) {
      const suffix = n.slice(1); // ".example.com"
      // A bare "*." (or a wildcard on a TLD) is not a real name.
      if (suffix.length < 3 || !suffix.slice(1).includes('.')) continue;
      if (!h.endsWith(suffix)) continue;
      const label = h.slice(0, h.length - suffix.length);
      if (label.length > 0 && !label.includes('.')) return true;
    }
  }
  return false;
}
