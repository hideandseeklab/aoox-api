import { parseBearerChallenge } from './remote-digest';

const TIMEOUT_MS = 15_000;

/**
 * Tag names of `repository` on a registry (`GET /v2/<repo>/tags/list`, the
 * Distribution API), anonymous — used for the public `hideandseeklab/aoox-*`
 * images. Same Bearer token flow as `fetchRemoteDigest` (Docker Hub answers
 * 401 + `WWW-Authenticate` first). Throws on any failure; callers decide how
 * loud that should be.
 */
export async function fetchRemoteTags(
  baseUrl: string,
  repository: string,
): Promise<string[]> {
  const url = `${baseUrl}/v2/${repository}/tags/list?n=1000`;
  const attempt = (authorization: string | null) =>
    fetch(url, {
      headers: authorization ? { Authorization: authorization } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res = await attempt(null);
  if (res.status === 401) {
    const challenge = parseBearerChallenge(res.headers.get('www-authenticate'));
    if (!challenge) {
      throw new Error(`Registry refused the request (401) for ${repository}`);
    }
    const tokenUrl = new URL(challenge.realm);
    for (const [k, v] of Object.entries(challenge.params)) {
      tokenUrl.searchParams.set(k, v);
    }
    const tokenRes = await fetch(tokenUrl, {
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
    res = await attempt(`Bearer ${token}`);
  }
  if (!res.ok) {
    throw new Error(`Tag list failed (${res.status}) for ${repository}`);
  }
  const body = (await res.json()) as { tags?: unknown };
  if (!Array.isArray(body.tags)) return [];
  return body.tags.filter((t): t is string => typeof t === 'string');
}
