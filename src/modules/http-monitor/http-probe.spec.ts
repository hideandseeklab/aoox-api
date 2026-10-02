/* eslint-disable @typescript-eslint/no-unsafe-member-access -- jest matchers (expect.any/objectContaining) and mock.calls are loosely typed */
import {
  MAX_REDIRECTS,
  parseExpectedCodes,
  probe,
  statusIsHealthy,
  validateMonitorPath,
} from './http-probe';

describe('validateMonitorPath', () => {
  it.each(['/', '/health', '/api/v1/ping?full=1', '/a%20b', '/status.json'])(
    'accepts %s',
    (p) => expect(validateMonitorPath(p)).toBeNull(),
  );

  it.each([
    ['', 'empty'],
    ['health', 'no leading slash'],
    ['//evil.example.com/x', 'protocol-relative'],
    ['http://evil.example.com/', 'absolute url'],
    ['https://169.254.169.254/latest', 'cloud metadata url'],
    ['/../etc/passwd', 'dot-dot segment'],
    ['/a/../b', 'dot-dot in the middle'],
    ['/%2e%2e/secret', 'encoded dot-dot'],
    ['/%2E%2E%2Fsecret', 'encoded dot-dot with slash'],
    ['/a\r\nHost: evil', 'CRLF injection'],
    ['/a\u0000b', 'NUL'],
    ['/a b', 'space'],
    ['/a\\b', 'backslash'],
    ['/a#frag', 'fragment'],
    ['/%zz', 'bad percent-encoding'],
    ['/' + 'a'.repeat(200), 'too long'],
  ])('rejects %j (%s)', (p) => expect(validateMonitorPath(p)).not.toBeNull());

  it('rejects non-strings', () => {
    expect(validateMonitorPath(undefined)).not.toBeNull();
    expect(validateMonitorPath(42)).not.toBeNull();
  });

  it('a validated path never changes the host it is joined to', () => {
    for (const p of ['/', '/x?y=http://evil', '/a@b']) {
      expect(validateMonitorPath(p)).toBeNull();
      expect(new URL(p, 'http://app.example.com:8088').host).toBe(
        'app.example.com:8088',
      );
    }
  });
});

describe('expected codes', () => {
  it('parses ranges and lists', () => {
    expect(parseExpectedCodes('200-399')).toEqual([[200, 399]]);
    expect(parseExpectedCodes('200,204,301-302')).toEqual([
      [200, 200],
      [204, 204],
      [301, 302],
    ]);
  });
  it.each([
    '',
    'abc',
    '99',
    '600',
    '399-200',
    '200-',
    '200,,204',
    '1,2,3,4,5,6,7,8,9,10,11',
  ])('rejects %j', (spec) => expect(parseExpectedCodes(spec)).toBeNull());
  it('judges a status by them', () => {
    expect(statusIsHealthy(200, '200-399')).toBe(true);
    expect(statusIsHealthy(302, '200-399')).toBe(true);
    expect(statusIsHealthy(404, '200-399')).toBe(false);
    expect(statusIsHealthy(500, '200-399')).toBe(false);
    expect(statusIsHealthy(204, '200,204')).toBe(true);
    expect(statusIsHealthy(201, '200,204')).toBe(false);
  });
});

function response(
  status: number,
  headers: Record<string, string> = {},
  body = '',
) {
  return new Response(body || null, { status, headers });
}

describe('probe', () => {
  const url = new URL('http://app.example.com/health');

  it('returns the status of a plain response and reads no more than the cap', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(response(200, {}, 'x'.repeat(200_000)));
    const r = await probe(url, 5, fetchMock);
    expect(r).toMatchObject({ statusCode: 200, error: null });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('follows a redirect on the same host', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(301, { location: '/login' }))
      .mockResolvedValueOnce(response(200));
    const r = await probe(url, 5, fetchMock);
    expect(r.statusCode).toBe(200);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'http://app.example.com/login',
    );
  });

  it('follows http -> https on the same hostname', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        response(308, { location: 'https://app.example.com/health' }),
      )
      .mockResolvedValueOnce(response(200));
    const r = await probe(url, 5, fetchMock);
    expect(r.statusCode).toBe(200);
  });

  it('does not follow a redirect to another host: the 3xx is the answer', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        response(302, { location: 'http://169.254.169.254/latest' }),
      );
    const r = await probe(url, 5, fetchMock);
    expect(r.statusCode).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not follow a redirect to another port of the same host', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        response(302, { location: 'http://app.example.com:5432/' }),
      );
    const r = await probe(url, 5, fetchMock);
    expect(r.statusCode).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // ...and a probe of a custom port does not follow a drop to the default port either.
    const custom = new URL('http://app.example.com:8088/');
    const again = jest
      .fn()
      .mockResolvedValue(
        response(302, { location: 'http://app.example.com/ok' }),
      );
    expect((await probe(custom, 5, again)).statusCode).toBe(302);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('does not follow a redirect to another scheme', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        response(302, { location: 'ftp://app.example.com/x' }),
      );
    const r = await probe(url, 5, fetchMock);
    expect(r.statusCode).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the redirect limit and returns the last 3xx', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(response(302, { location: '/again' })),
      );
    const r = await probe(url, 5, fetchMock);
    expect(r.statusCode).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it('reports a network error as a short code, never a stack', async () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    const fetchMock = jest.fn().mockRejectedValue(err);
    const r = await probe(url, 5, fetchMock);
    expect(r).toMatchObject({ statusCode: null, error: 'ECONNREFUSED' });
  });

  it('reports a timeout', async () => {
    const fetchMock = jest.fn().mockImplementation(
      (_u: unknown, init: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(init.signal.reason as Error),
          );
        }),
    );
    const r = await probe(url, 1, fetchMock);
    expect(r.statusCode).toBeNull();
    expect(r.error).toBe('timeout after 1s');
  }, 10_000);
});
