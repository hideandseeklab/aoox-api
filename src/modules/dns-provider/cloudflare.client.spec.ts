import { CloudflareClient, DnsProviderError } from './cloudflare.client';
import { candidateZoneNames, matchZone } from './zone-match';

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

function fakeFetch(handler: (c: Call) => { status?: number; body: unknown }): {
  calls: Call[];
  restore: () => void;
} {
  const calls: Call[] = [];
  const original = global.fetch;
  global.fetch = jest.fn((url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const call: Call = {
      url,
      method: init.method ?? 'GET',
      auth: headers.Authorization ?? null,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return Promise.resolve({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body),
    });
  }) as never;
  return { calls, restore: () => (global.fetch = original) };
}

const ok = (result: unknown) => ({ body: { success: true, result } });

describe('zone matching', () => {
  it('lists candidate zone names longest first, never a bare TLD', () => {
    expect(candidateZoneNames('a.b.example.co.uk')).toEqual([
      'a.b.example.co.uk',
      'b.example.co.uk',
      'example.co.uk',
      'co.uk',
    ]);
    expect(candidateZoneNames('example.com')).toEqual(['example.com']);
    expect(candidateZoneNames('localhost')).toEqual([]);
  });

  it('picks the longest suffix match and ignores lookalikes', () => {
    const zones = [
      { id: '1', name: 'example.com' },
      { id: '2', name: 'dev.example.com' },
      { id: '3', name: 'ample.com' },
    ];
    expect(matchZone('app.dev.example.com', zones)?.id).toBe('2');
    expect(matchZone('app.example.com', zones)?.id).toBe('1');
    expect(matchZone('example.com', zones)?.id).toBe('1');
    expect(matchZone('badexample.com', zones)).toBeNull();
  });
});

describe('CloudflareClient', () => {
  let fake: ReturnType<typeof fakeFetch>;
  afterEach(() => fake.restore());

  it('verifies a user token on /user/tokens/verify with a Bearer header', async () => {
    fake = fakeFetch(() => ok({ id: 'x', status: 'active' }));
    const c = new CloudflareClient('secret-token', 'https://cf.test/client/v4');
    await expect(c.verifyToken()).resolves.toEqual({
      id: 'x',
      status: 'active',
    });
    expect(fake.calls[0]).toMatchObject({
      url: 'https://cf.test/client/v4/user/tokens/verify',
      method: 'GET',
      auth: 'Bearer secret-token',
    });
  });

  it('uses the account endpoint for account-owned tokens', async () => {
    fake = fakeFetch(() => ok({ status: 'active' }));
    const c = new CloudflareClient('t', 'https://cf.test/v4', 'acc123');
    await c.verifyToken();
    expect(fake.calls[0].url).toBe(
      'https://cf.test/v4/accounts/acc123/tokens/verify',
    );
  });

  it('finds the zone by exact-name lookups, longest candidate first', async () => {
    fake = fakeFetch((c) => {
      const name = new URL(c.url).searchParams.get('name');
      return ok(
        name === 'example.com' ? [{ id: 'z1', name: 'example.com' }] : [],
      );
    });
    const c = new CloudflareClient('t', 'https://cf.test/v4');
    await expect(c.findZone('app.sub.example.com')).resolves.toEqual({
      id: 'z1',
      name: 'example.com',
    });
    expect(
      fake.calls.map((x) => new URL(x.url).searchParams.get('name')),
    ).toEqual(['app.sub.example.com', 'sub.example.com', 'example.com']);
  });

  it('creates, patches and deletes records on the documented paths', async () => {
    fake = fakeFetch((c) =>
      ok(c.method === 'DELETE' ? { id: 'r1' } : { id: 'r1', type: 'A' }),
    );
    const c = new CloudflareClient('t', 'https://cf.test/v4');
    await c.createRecord('z1', {
      type: 'A',
      name: 'a.example.com',
      content: '1.2.3.4',
      proxied: false,
      comment: 'Managed by aoox',
    });
    await c.updateRecord('z1', 'r1', { content: '5.6.7.8', proxied: true });
    await c.deleteRecord('z1', 'r1');
    expect(
      fake.calls.map((x) => `${x.method} ${new URL(x.url).pathname}`),
    ).toEqual([
      'POST /v4/zones/z1/dns_records',
      'PATCH /v4/zones/z1/dns_records/r1',
      'DELETE /v4/zones/z1/dns_records/r1',
    ]);
    expect(fake.calls[0].body).toMatchObject({ ttl: 1, proxied: false });
  });

  it('turns API errors into short messages that never contain the token', async () => {
    fake = fakeFetch(() => ({
      status: 403,
      body: {
        success: false,
        errors: [{ code: 9109, message: 'Invalid access token' }],
      },
    }));
    const c = new CloudflareClient('super-secret-token', 'https://cf.test/v4');
    const err = await c.listZones().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DnsProviderError);
    expect((err as Error).message).toBe(
      'Cloudflare answered 403: Invalid access token',
    );
    expect((err as Error).message).not.toContain('super-secret-token');
  });

  it('reports unreachable servers without leaking the url or token', async () => {
    const original = global.fetch;
    global.fetch = jest.fn(() =>
      Promise.reject(
        Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        }),
      ),
    ) as never;
    fake = { calls: [], restore: () => (global.fetch = original) };
    const c = new CloudflareClient('tok-12345', 'https://cf.test/v4');
    await expect(c.listZones()).rejects.toThrow(
      'Could not reach Cloudflare (ECONNREFUSED)',
    );
  });
});
