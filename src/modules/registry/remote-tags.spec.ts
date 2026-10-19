import { fetchRemoteTags } from './remote-tags';

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('fetchRemoteTags', () => {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('lists tags anonymously when the registry allows it', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ tags: ['latest', '0.1.0-alpha.3'] }),
    );
    await expect(fetchRemoteTags('http://reg', 'org/app')).resolves.toEqual([
      'latest',
      '0.1.0-alpha.3',
    ]);
    expect(fetchMock.mock.calls[0][0] as string).toBe(
      'http://reg/v2/org/app/tags/list?n=1000',
    );
  });

  it('follows the Bearer token challenge (Docker Hub)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('', {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://auth.example/token",service="registry",scope="repository:org/app:pull"',
          },
        }),
      )
      .mockResolvedValueOnce(json({ token: 'tok' }))
      .mockResolvedValueOnce(json({ tags: ['1.0.0'] }));
    await expect(fetchRemoteTags('http://reg', 'org/app')).resolves.toEqual([
      '1.0.0',
    ]);
    const tokenUrl = (fetchMock.mock.calls[1][0] as URL).toString();
    expect(tokenUrl).toContain('https://auth.example/token');
    expect(tokenUrl).toContain('service=registry');
    const init = fetchMock.mock.calls[2][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
  });

  it('returns [] when the body has no tag list and ignores non-strings', async () => {
    fetchMock.mockResolvedValueOnce(json({ tags: null }));
    await expect(fetchRemoteTags('http://reg', 'org/app')).resolves.toEqual([]);
    fetchMock.mockResolvedValueOnce(json({ tags: ['a', 3, null, 'b'] }));
    await expect(fetchRemoteTags('http://reg', 'org/app')).resolves.toEqual([
      'a',
      'b',
    ]);
  });

  it.each([
    ['a server error', () => new Response('boom', { status: 500 })],
    ['a 401 without a challenge', () => new Response('', { status: 401 })],
  ])('throws on %s', async (_l, res) => {
    fetchMock.mockResolvedValueOnce(res());
    await expect(fetchRemoteTags('http://reg', 'org/app')).rejects.toThrow();
  });

  it('throws when the token endpoint refuses', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('', {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="https://auth.example/t"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(fetchRemoteTags('http://reg', 'org/app')).rejects.toThrow(
      /token request failed \(403\)/,
    );
  });

  it('sends Basic credentials on the first request and the token request', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('', {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer realm="https://auth.example/t",service="r"',
          },
        }),
      )
      .mockResolvedValueOnce(json({ token: 'tok' }))
      .mockResolvedValueOnce(json({ tags: ['1.0.0'] }));
    await fetchRemoteTags('http://reg', 'org/app', {
      username: 'u',
      password: 'p',
    });
    const basic = 'Basic ' + Buffer.from('u:p').toString('base64');
    expect(
      (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe(basic);
    expect(
      (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe(basic);
    expect(
      (fetchMock.mock.calls[2][1]?.headers as Record<string, string>)
        .Authorization,
    ).toBe('Bearer tok');
  });

  it('never puts credentials in an error message', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(
      fetchRemoteTags('http://reg', 'org/app', {
        username: 'u',
        password: 'hunter2',
      }),
    ).rejects.not.toThrow(/hunter2/);
  });

  it('follows Link rel=next on the same origin and ignores other origins', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ tags: ['a'] }, 200, {
          link: '</v2/org/app/tags/list?last=a&n=1000>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(
        json({ tags: ['b'] }, 200, {
          link: '<https://evil.example/v2/x>; rel="next"',
        }),
      );
    await expect(fetchRemoteTags('http://reg', 'org/app')).resolves.toEqual([
      'a',
      'b',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0] as string).toBe(
      'http://reg/v2/org/app/tags/list?last=a&n=1000',
    );
  });
});
