import { RegistryClient } from './registry-client';

describe('RegistryClient', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeAll(() => {
    global.fetch = fetchMock;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });
  beforeEach(() => fetchMock.mockReset());

  const respond = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status, headers }),
    );

  it('sends basic auth and lists repositories', async () => {
    respond(200, { repositories: ['a/b', 'c'] });
    const client = new RegistryClient('http://reg:5000', {
      username: 'u',
      password: 'p',
    });
    await expect(client.listRepositories()).resolves.toEqual(['a/b', 'c']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://reg:5000/v2/_catalog?n=1000');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('u:p').toString('base64')}`,
    );
  });

  it('reads the digest from the manifest response header and sums sizes', async () => {
    respond(
      200,
      { config: { size: 10 }, layers: [{ size: 100 }, { size: 200 }] },
      { 'docker-content-digest': 'sha256:abc' },
    );
    const tag = await new RegistryClient('http://reg').getTag('a/b', 'v1');
    expect(tag).toEqual({ name: 'v1', digest: 'sha256:abc', size: 310 });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Accept).toContain(
      'manifest.v2+json',
    );
  });

  it('treats a null tag list as empty and surfaces http errors', async () => {
    respond(200, { name: 'a', tags: null });
    await expect(
      new RegistryClient('http://reg').listTagNames('a'),
    ).resolves.toEqual([]);
    respond(401, { errors: [] });
    await expect(
      new RegistryClient('http://reg').check(),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('deletes by digest with the DELETE method', async () => {
    respond(202, {});
    await new RegistryClient('http://reg').deleteManifest('a', 'sha256:abc');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://reg/v2/a/manifests/sha256:abc');
    expect(init.method).toBe('DELETE');
  });
});
