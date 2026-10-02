import {
  baseUrl,
  fetchSecrets,
  INFISICAL_TIMEOUT_MS,
  login,
  parseSecrets,
  SecretSourceError,
} from './infisical.client';

const CREDS = {
  url: null,
  clientId: 'client-id',
  clientSecret: 'super-secret-client-value',
};
const SEL = { projectId: 'proj_1', environment: 'prod', path: '/api' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('infisical client', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  const calls = () =>
    fetchMock.mock.calls as Array<[string, RequestInit | undefined]>;

  it('logs in with Universal Auth and lists the folder (v4), imports first and own secrets winning', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 'tok-123', expiresIn: 7200 }))
      .mockResolvedValueOnce(
        json({
          secrets: [
            { secretKey: 'A', secretValue: 'own-a' },
            { secretKey: 'B', secretValue: 'own-b' },
          ],
          imports: [
            {
              secrets: [
                { secretKey: 'A', secretValue: 'imported-a' },
                { secretKey: 'C', secretValue: 'imported-c' },
              ],
            },
          ],
        }),
      );
    const out = await fetchSecrets(CREDS, SEL);
    expect(Object.fromEntries(out)).toEqual({
      A: 'own-a',
      B: 'own-b',
      C: 'imported-c',
    });

    const [loginUrl, loginInit] = calls()[0];
    expect(loginUrl).toBe(
      'https://app.infisical.com/api/v1/auth/universal-auth/login',
    );
    expect(loginInit?.method).toBe('POST');
    expect(JSON.parse(loginInit?.body as string)).toEqual({
      clientId: 'client-id',
      clientSecret: 'super-secret-client-value',
    });
    expect(loginInit?.signal).toBeDefined();

    const [listUrl, listInit] = calls()[1];
    const u = new URL(listUrl);
    expect(u.pathname).toBe('/api/v4/secrets');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      projectId: 'proj_1',
      environment: 'prod',
      secretPath: '/api',
      recursive: 'false',
      includeImports: 'true',
      expandSecretReferences: 'true',
    });
    expect((listInit?.headers as Record<string, string>).authorization).toBe(
      'Bearer tok-123',
    );
  });

  it('uses the configured base URL (self-hosted), trailing slash removed', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 't' }))
      .mockResolvedValueOnce(json({ secrets: [] }));
    await fetchSecrets({ ...CREDS, url: 'https://secrets.example.com/' }, SEL);
    expect(calls()[0][0]).toBe(
      'https://secrets.example.com/api/v1/auth/universal-auth/login',
    );
    expect(baseUrl('http://10.0.0.5:8080///')).toBe('http://10.0.0.5:8080');
    expect(baseUrl('')).toBe('https://app.infisical.com');
  });

  it('falls back to the v3 raw endpoint (workspaceId, include_imports) when v4 is 404', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 't' }))
      .mockResolvedValueOnce(json({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(
        json({ secrets: [{ secretKey: 'K', secretValue: 'v' }] }),
      );
    const out = await fetchSecrets(CREDS, SEL);
    expect(out.get('K')).toBe('v');
    const u = new URL(calls()[2][0]);
    expect(u.pathname).toBe('/api/v3/secrets/raw');
    expect(u.searchParams.get('workspaceId')).toBe('proj_1');
    expect(u.searchParams.get('include_imports')).toBe('true');
  });

  it('a 404 on both endpoints reports the failure instead of an empty result', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 't' }))
      .mockResolvedValueOnce(json({ message: 'Project not found' }, 404))
      .mockResolvedValueOnce(json({ message: 'Project not found' }, 404));
    await expect(fetchSecrets(CREDS, SEL)).rejects.toThrow(
      'list secrets failed (HTTP 404: Project not found)',
    );
  });

  it('401 on login: short message from Infisical, never the credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ message: 'Invalid credentials', statusCode: 401 }, 401),
    );
    const err = await login(CREDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecretSourceError);
    expect((err as Error).message).toBe(
      'login failed (HTTP 401: Invalid credentials)',
    );
    expect((err as Error).message).not.toContain('super-secret-client-value');
    expect((err as Error).message).not.toContain('client-id');
  });

  it('403 while listing keeps the status and message, nothing else', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 'tok-secret' }))
      .mockResolvedValueOnce(
        json({ message: 'Forbidden', details: { rule: 'x' } }, 403),
      );
    const err = await fetchSecrets(CREDS, SEL).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'list secrets failed (HTTP 403: Forbidden)',
    );
    expect((err as Error).message).not.toContain('tok-secret');
  });

  it('a timeout becomes a short message', async () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError');
    fetchMock.mockRejectedValueOnce(timeout);
    await expect(login(CREDS)).rejects.toThrow(
      `login: no answer within ${INFISICAL_TIMEOUT_MS / 1000}s`,
    );
  });

  it('a network error keeps the code but not the URL', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' },
      }),
    );
    await expect(login(CREDS)).rejects.toThrow(
      'login: could not reach the server (ECONNREFUSED)',
    );
  });

  it('broken responses are rejected', async () => {
    fetchMock.mockResolvedValueOnce(json({ nope: true }));
    await expect(login(CREDS)).rejects.toThrow('login: unexpected response');

    fetchMock.mockResolvedValueOnce(
      new Response('<html>oops</html>', { status: 200 }),
    );
    await expect(login(CREDS)).rejects.toThrow('login: unexpected response');

    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 't' }))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(fetchSecrets(CREDS, SEL)).rejects.toThrow(
      'list secrets: unexpected response',
    );

    expect(() => parseSecrets({ secrets: 'x' })).toThrow(SecretSourceError);
    expect(() => parseSecrets(null)).toThrow(SecretSourceError);
  });

  it('skips hidden values and malformed entries', () => {
    const out = parseSecrets({
      secrets: [
        { secretKey: 'OK', secretValue: 'v' },
        { secretKey: 'HIDDEN', secretValue: '', secretValueHidden: true },
        { secretKey: 'NOVALUE' },
        { secretValue: 'nokey' },
        null,
      ],
    });
    expect([...out.keys()]).toEqual(['OK']);
  });

  it('never stores anything between calls: a second fetch logs in again', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ accessToken: 't1' }))
      .mockResolvedValueOnce(json({ secrets: [] }))
      .mockResolvedValueOnce(json({ accessToken: 't2' }))
      .mockResolvedValueOnce(json({ secrets: [] }));
    await fetchSecrets(CREDS, SEL);
    await fetchSecrets(CREDS, SEL);
    expect(
      calls().filter(([u]) => u.includes('universal-auth/login')),
    ).toHaveLength(2);
  });
});
