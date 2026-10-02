/**
 * Minimal Infisical client (fetch only, no SDK): Universal Auth login, then
 * list the secrets of one project/environment/path.
 *
 * Endpoints (https://infisical.com/docs/api-reference):
 *   POST /api/v1/auth/universal-auth/login  { clientId, clientSecret } -> { accessToken }
 *   GET  /api/v4/secrets?projectId&environment&secretPath&includeImports&
 *        expandSecretReferences&recursive            (Bearer token)
 *   GET  /api/v3/secrets/raw?workspaceId&environment&secretPath&include_imports&
 *        expandSecretReferences&recursive            (older self-hosted instances)
 *
 * The access token lives only inside one `fetchSecrets` call. Error messages
 * are built from the HTTP status and Infisical's own `message` field; they
 * never contain the client secret, the token or any secret value.
 */

export const DEFAULT_INFISICAL_URL = 'https://app.infisical.com';
export const INFISICAL_TIMEOUT_MS = 10_000;

export class SecretSourceError extends Error {}

export interface InfisicalCredentials {
  /** null = Infisical Cloud. */
  url: string | null;
  clientId: string;
  clientSecret: string;
}

export interface InfisicalSelection {
  projectId: string;
  environment: string;
  path: string;
}

/** `https://host[:port][/prefix]` without a trailing slash. */
export function baseUrl(url: string | null | undefined): string {
  return (url?.trim() || DEFAULT_INFISICAL_URL).replace(/\/+$/, '');
}

/** Short, credential-free description of a failed response. */
async function describe(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === 'string') detail = body.message;
  } catch {
    // not JSON: the status alone is enough
  }
  detail = detail.replace(/\s+/g, ' ').slice(0, 160);
  return detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`;
}

function failure(step: string, err: unknown): SecretSourceError {
  if (err instanceof SecretSourceError) return err;
  // DOMException (what AbortSignal.timeout rejects with) is not always `instanceof Error`.
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new SecretSourceError(
      `${step}: no answer within ${INFISICAL_TIMEOUT_MS / 1000}s`,
    );
  }
  const cause = (err as { cause?: { code?: string } } | undefined)?.cause?.code;
  return new SecretSourceError(
    `${step}: could not reach the server${cause ? ` (${cause})` : ''}`,
  );
}

/** Universal Auth login; returns the short-lived access token. */
export async function login(c: InfisicalCredentials): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(c.url)}/api/v1/auth/universal-auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
      }),
      signal: AbortSignal.timeout(INFISICAL_TIMEOUT_MS),
    });
  } catch (err) {
    throw failure('login', err);
  }
  if (!res.ok) {
    throw new SecretSourceError(`login failed (${await describe(res)})`);
  }
  let token: unknown;
  try {
    token = ((await res.json()) as { accessToken?: unknown }).accessToken;
  } catch {
    token = undefined;
  }
  if (typeof token !== 'string' || !token) {
    throw new SecretSourceError('login: unexpected response');
  }
  return token;
}

interface RawSecret {
  secretKey?: unknown;
  secretValue?: unknown;
  secretValueHidden?: unknown;
}

interface ListResponse {
  secrets?: unknown;
  imports?: unknown;
}

function collect(into: Map<string, string>, list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const s of list as RawSecret[]) {
    if (typeof s?.secretKey !== 'string' || !s.secretKey) continue;
    // A machine identity without "read value" permission gets hidden values.
    if (s.secretValueHidden === true) continue;
    if (typeof s.secretValue !== 'string') continue;
    into.set(s.secretKey, s.secretValue);
  }
}

/** Parsed list response: imported secrets first, the folder's own secrets win. */
export function parseSecrets(body: unknown): Map<string, string> {
  if (!body || typeof body !== 'object') {
    throw new SecretSourceError('list secrets: unexpected response');
  }
  const { secrets, imports } = body as ListResponse;
  if (!Array.isArray(secrets)) {
    throw new SecretSourceError('list secrets: unexpected response');
  }
  const out = new Map<string, string>();
  if (Array.isArray(imports)) {
    for (const imp of imports as Array<{ secrets?: unknown }>) {
      collect(out, imp?.secrets);
    }
  }
  collect(out, secrets);
  return out;
}

async function get(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(INFISICAL_TIMEOUT_MS),
  });
}

/** Secrets of one folder as key -> value (imports included, own secrets win). */
export async function listSecrets(
  c: InfisicalCredentials,
  token: string,
  sel: InfisicalSelection,
): Promise<Map<string, string>> {
  const base = baseUrl(c.url);
  const v4 = new URLSearchParams({
    projectId: sel.projectId,
    environment: sel.environment,
    secretPath: sel.path,
    recursive: 'false',
    includeImports: 'true',
    expandSecretReferences: 'true',
  });
  let res: Response;
  try {
    res = await get(`${base}/api/v4/secrets?${v4.toString()}`, token);
    if (res.status === 404) {
      // Older self-hosted versions only have the v3 raw endpoint (same data,
      // different parameter names). A real "not found" answers 404 there too.
      const v3 = new URLSearchParams({
        workspaceId: sel.projectId,
        environment: sel.environment,
        secretPath: sel.path,
        recursive: 'false',
        include_imports: 'true',
        expandSecretReferences: 'true',
      });
      const fallback = await get(
        `${base}/api/v3/secrets/raw?${v3.toString()}`,
        token,
      );
      if (fallback.ok || fallback.status !== 404) res = fallback;
    }
  } catch (err) {
    throw failure('list secrets', err);
  }
  if (!res.ok) {
    throw new SecretSourceError(`list secrets failed (${await describe(res)})`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SecretSourceError('list secrets: unexpected response');
  }
  return parseSecrets(body);
}

/** Login + list in one go; the token never leaves this function. */
export async function fetchSecrets(
  c: InfisicalCredentials,
  sel: InfisicalSelection,
): Promise<Map<string, string>> {
  const token = await login(c);
  return listSecrets(c, token, sel);
}
