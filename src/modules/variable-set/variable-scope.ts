/**
 * API token scope on variable set environments (pure, no Nest imports).
 * Entries are `<set-slug>/<env>`, `<set-slug>/*` or `*` + `/<env>` (the
 * environment name in every set); a token
 * without entries (null) is not narrowed. A scope only ever narrows what the
 * token's user may do; it never grants anything.
 */
export const VARIABLE_SCOPE =
  /^(?:\*|[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/(?:\*|[a-z0-9-]{1,32})$/;

export function variableScopeAllows(
  scopes: string[] | null | undefined,
  setSlug: string,
  environment: string,
): boolean {
  if (!scopes) return true;
  return scopes.some((entry) => {
    const at = entry.indexOf('/');
    if (at <= 0) return false;
    const s = entry.slice(0, at);
    const e = entry.slice(at + 1);
    return (s === '*' || s === setSlug) && (e === '*' || e === environment);
  });
}

/**
 * How the old `api_tokens.environments` (plain environment names) map to
 * variable scopes: the same name in every set, so no existing token gains or
 * loses anything by name.
 */
export function scopesFromEnvironmentNames(names: unknown): string[] | null {
  if (!Array.isArray(names)) return null;
  const out = [
    ...new Set(
      names
        .filter((n): n is string => typeof n === 'string')
        .map((n) => `*/${n}`)
        .filter((s) => VARIABLE_SCOPE.test(s)),
    ),
  ];
  return out.length > 0 ? out : null;
}
