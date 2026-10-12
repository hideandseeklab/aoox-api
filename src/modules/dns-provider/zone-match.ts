/** Pure helpers to pick the DNS zone a host belongs to. */

/**
 * Zone names to try for a host, longest first, with at least two labels
 * (`a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`).
 */
export function candidateZoneNames(host: string): string[] {
  const labels = host.trim().toLowerCase().replace(/\.$/, '').split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    out.push(labels.slice(i).join('.'));
  }
  return out;
}

/** The zone with the longest name that is the host or one of its parents. */
export function matchZone<T extends { name: string }>(
  host: string,
  zones: T[],
): T | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  let best: T | null = null;
  for (const z of zones) {
    const name = z.name.toLowerCase();
    if (h === name || h.endsWith(`.${name}`)) {
      if (!best || name.length > best.name.length) best = z;
    }
  }
  return best;
}
