import { createHash } from 'crypto';
import type { RegistryCredentials } from './registry-client';

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
].join(', ');

const TIMEOUT_MS = 15_000;

/** Parses `Bearer realm="…",service="…",scope="…"` (Distribution token auth spec). */
export function parseBearerChallenge(
  header: string | null,
): { realm: string; params: Record<string, string> } | null {
  if (!header || !/^bearer /i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const m of header.slice(7).matchAll(/(\w+)="([^"]*)"/g)) {
    params[m[1]] = m[2];
  }
  if (!params.realm) return null;
  const { realm, ...rest } = params;
  return { realm, params: rest };
}

/**
 * Digest of `repository:tag` on a registry, via `HEAD /v2/<repo>/manifests/<tag>`
 * (the same request Docker makes before a pull). Handles the token flow used by
 * Docker Hub/GHCR (401 + `WWW-Authenticate: Bearer`) with optional credentials,
 * and plain basic auth for self-hosted registries. Falls back to hashing the
 * manifest body when the server does not send `Docker-Content-Digest`.
 */
export async function fetchRemoteDigest(
  baseUrl: string,
  repository: string,
  tag: string,
  creds: RegistryCredentials = {},
): Promise<string> {
  const url = `${baseUrl}/v2/${repository}/manifests/${encodeURIComponent(tag)}`;
  const basic =
    creds.username && creds.password
      ? `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`
      : null;
  const attempt = (authorization: string | null, method: 'HEAD' | 'GET') =>
    fetch(url, {
      method,
      headers: {
        Accept: MANIFEST_ACCEPT,
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res = await attempt(basic, 'HEAD');
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
    res = await attempt(`Bearer ${token}`, 'HEAD');
    if (res.ok && !res.headers.get('docker-content-digest')) {
      res = await attempt(`Bearer ${token}`, 'GET');
    }
  } else if (res.ok && !res.headers.get('docker-content-digest')) {
    res = await attempt(basic, 'GET');
  }
  if (!res.ok) {
    throw new Error(
      `Manifest lookup failed (${res.status}) for ${repository}:${tag}`,
    );
  }
  const header = res.headers.get('docker-content-digest');
  if (header) return header;
  const bytes = Buffer.from(await res.arrayBuffer());
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
