import { parseBearerChallenge } from './remote-digest';
import type { RegistryCredentials } from './registry-client';

const TIMEOUT_MS = 15_000;
/** Pages followed through `Link: rel="next"` (1000 tags each). */
const MAX_PAGES = 10;

/**
 * Tag names of `repository` on a registry (`GET /v2/<repo>/tags/list`, the
 * Distribution API). Anonymous unless `creds` are given (Basic, also sent on
 * the token request for Docker Hub/GHCR style Bearer flows — the same auth
 * paths as `fetchRemoteDigest`). Docker Hub answers 401 + `WWW-Authenticate`
 * first. Registries sort tags and paginate (`n=1000` + a `Link` header), so
 * the next pages are followed (same origin only, at most `MAX_PAGES`). Throws
 * on any failure; callers decide how loud that should be. Messages never
 * contain credentials.
 */
export async function fetchRemoteTags(
  baseUrl: string,
  repository: string,
  creds: RegistryCredentials = {},
): Promise<string[]> {
  const basic =
    creds.username && creds.password
      ? `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`
      : null;
  let authorization: string | null = basic;
  const attempt = (url: string) =>
    fetch(url, {
      headers: authorization ? { Authorization: authorization } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const tags: string[] = [];
  let url: string | null = `${baseUrl}/v2/${repository}/tags/list?n=1000`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    let res = await attempt(url);
    if (res.status === 401 && !authorization?.startsWith('Bearer ')) {
      const challenge = parseBearerChallenge(
        res.headers.get('www-authenticate'),
      );
      if (!challenge) {
        throw new Error(`Registry refused the request (401) for ${repository}`);
      }
      const tokenUrl = new URL(challenge.realm);
      for (const [k, v] of Object.entries(challenge.params)) {
        tokenUrl.searchParams.set(k, v);
      }
      const tokenRes = await fetch(tokenUrl, {
        headers: basic ? { Authorization: basic } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!tokenRes.ok) {
        throw new Error(
          `Registry token request failed (${tokenRes.status}) for ${repository}`,
        );
      }
      const body = (await tokenRes.json()) as {
        token?: string;
        access_token?: string;
      };
      const token = body.token ?? body.access_token;
      if (!token) throw new Error('Registry token response had no token');
      authorization = `Bearer ${token}`;
      res = await attempt(url);
    }
    if (!res.ok) {
      throw new Error(`Tag list failed (${res.status}) for ${repository}`);
    }
    const body = (await res.json()) as { tags?: unknown };
    if (Array.isArray(body.tags)) {
      for (const t of body.tags) if (typeof t === 'string') tags.push(t);
    }
    url = nextPage(res.headers.get('link'), baseUrl);
  }
  return tags;
}

/** `Link: </v2/x/tags/list?last=a&n=1000>; rel="next"` -> absolute URL on the same origin. */
function nextPage(link: string | null, baseUrl: string): string | null {
  if (!link) return null;
  const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link);
  if (!m) return null;
  try {
    const base = new URL(baseUrl);
    const next = new URL(m[1], base);
    return next.origin === base.origin ? next.toString() : null;
  } catch {
    return null;
  }
}
