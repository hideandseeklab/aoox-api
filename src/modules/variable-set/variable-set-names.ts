/**
 * Pure naming helpers for variable sets, shared by the service, project
 * import and the VariableSets migration (no Nest or TypeORM imports).
 */

export const SET_NAME_MAX = 100;
export const SET_SLUG_MAX = 64;

/** `My Shop API` -> `my-shop-api`; never empty (`set`). */
export function slugifySetName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SET_SLUG_MAX)
    .replace(/-+$/g, '');
  return slug || 'set';
}

/** `name`, else `name (2)`, `name (3)`, … not in `taken` (compared case-insensitively). */
export function uniqueSetName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const base = name.trim().slice(0, SET_NAME_MAX) || 'Variables';
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = base.slice(0, SET_NAME_MAX - suffix.length) + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** `slug`, else `slug-2`, `slug-3`, … not in `taken`. */
export function uniqueSetSlug(slug: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate =
      slug.slice(0, SET_SLUG_MAX - suffix.length).replace(/-+$/g, '') + suffix;
    if (!used.has(candidate)) return candidate;
  }
}
