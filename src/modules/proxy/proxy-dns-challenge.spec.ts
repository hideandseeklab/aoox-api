import { ProxyService } from './proxy.service';

const acme = { httpsPort: 443, acme: true };
const domains = [
  { host: 'a.example.com', https: true },
  { host: 'plain.example.com', https: false },
  { host: 'c.example.com', https: true, customCert: true },
];

describe('ProxyService.buildLabels without a DNS provider', () => {
  it('is byte-identical whether dnsResolver is absent or false, even when domains ask for DNS-01', () => {
    const asking = domains.map((d) => ({ ...d, dns: { main: 'example.com' } }));
    const base = ProxyService.buildLabels('app', 80, domains, acme);
    expect(
      ProxyService.buildLabels('app', 80, domains, {
        ...acme,
        dnsResolver: false,
      }),
    ).toEqual(base);
    // A domain that asks for DNS-01 on a proxy without the resolver keeps HTTP-01.
    expect(ProxyService.buildLabels('app', 80, asking, acme)).toEqual(base);
    expect(Object.values(base)).not.toContain('le-dns');
  });
});

describe('ProxyService.buildLabels with the le-dns resolver', () => {
  const opts = { ...acme, dnsResolver: true };

  it('keeps hosts that do not ask for DNS-01 on the le resolver', () => {
    expect(ProxyService.buildLabels('app', 80, domains, opts)).toEqual(
      ProxyService.buildLabels('app', 80, domains, acme),
    );
  });

  it('puts a per-host DNS-01 domain on its own le-dns router and still redirects http', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [
        { host: 'a.example.com', https: true },
        { host: 'b.example.com', https: true, dns: {} },
      ],
      opts,
    );
    expect(labels['traefik.http.routers.app-secure.rule']).toBe(
      'Host(`a.example.com`)',
    );
    expect(labels['traefik.http.routers.app-secure.tls.certresolver']).toBe(
      'le',
    );
    expect(labels['traefik.http.routers.app-secure-dns.rule']).toBe(
      'Host(`b.example.com`)',
    );
    expect(labels['traefik.http.routers.app-secure-dns.tls.certresolver']).toBe(
      'le-dns',
    );
    expect(
      labels['traefik.http.routers.app-secure-dns.tls.domains[0].main'],
    ).toBeUndefined();
    expect(labels['traefik.http.routers.app-redirect.rule']).toContain(
      'b.example.com',
    );
  });

  it('declares the wildcard (main + *.main) for a wildcard base, one router per base', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [
        { host: 'x.example.com', https: true, dns: { main: 'example.com' } },
        { host: 'y.example.com', https: true, dns: { main: 'example.com' } },
        { host: 'z.other.org', https: true, dns: { main: 'other.org' } },
      ],
      opts,
    );
    const routers = Object.keys(labels)
      .filter((k) => k.endsWith('.tls.domains[0].main'))
      .map((k) => k.split('.')[3]);
    expect(routers).toHaveLength(2);
    const shared = routers.find(
      (r) =>
        labels[`traefik.http.routers.${r}.tls.domains[0].main`] ===
        'example.com',
    )!;
    expect(labels[`traefik.http.routers.${shared}.rule`]).toBe(
      'Host(`x.example.com`) || Host(`y.example.com`)',
    );
    expect(labels[`traefik.http.routers.${shared}.tls.domains[0].sans`]).toBe(
      '*.example.com',
    );
    expect(labels[`traefik.http.routers.${shared}.tls.certresolver`]).toBe(
      'le-dns',
    );
    // No plain le router is left behind.
    expect(labels['traefik.http.routers.app-secure.rule']).toBeUndefined();
  });

  it('never routes a custom-certificate host through DNS-01', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [{ host: 'c.example.com', https: true, customCert: true, dns: {} }],
      opts,
    );
    expect(Object.values(labels)).not.toContain('le-dns');
  });
});

describe('ProxyService DNS-01 detection and provisioning', () => {
  it('recognises a proxy created with the DNS resolver', () => {
    expect(
      ProxyService.supportsDnsChallenge({
        Config: {
          Cmd: [
            '--certificatesresolvers.le-dns.acme.dnschallenge.provider=cloudflare',
          ],
        },
      }),
    ).toBe(true);
    expect(ProxyService.supportsDnsChallenge({ Config: { Cmd: [] } })).toBe(
      false,
    );
  });

  function setup(creds: { provider: 'cloudflare'; token: string } | null) {
    const created: Array<Record<string, unknown>> = [];
    const engine = {
      target: 'local',
      createVolume: jest.fn().mockResolvedValue(undefined),
      systemInfo: jest.fn().mockResolvedValue({}),
      removeContainer: jest.fn(),
      createContainer: jest.fn((body: Record<string, unknown>) => {
        created.push(body);
        return Promise.resolve('id1');
      }),
      startContainer: jest.fn().mockResolvedValue(undefined),
    };
    const docker = {
      engine,
      hostDockerSocket: '/var/run/docker.sock',
      ensureImage: jest.fn().mockResolvedValue(undefined),
      ensureNetwork: jest.fn().mockResolvedValue(undefined),
      findContainerByName: jest.fn().mockResolvedValue(null),
    };
    const credentialsFor = jest.fn().mockResolvedValue(creds);
    const proxy = new ProxyService(
      { logConfig: undefined } as never,
      { get: jest.fn() } as never,
      { credentialsFor } as never,
    );
    return { proxy, docker, created, credentialsFor };
  }
  const settings = {
    httpPort: 80,
    httpsPort: 443,
    acmeEmail: 'ops@example.com',
    acmeStaging: false,
  };

  it('adds the le-dns resolver, its own storage and the token env only when bound', async () => {
    const { proxy, docker, created, credentialsFor } = setup({
      provider: 'cloudflare',
      token: 'tok_secret_value',
    });
    await proxy.provisionOn(docker as never, { ...settings, serverId: 's1' });
    expect(credentialsFor).toHaveBeenCalledWith('s1');
    const body = created[0] as { Cmd: string[]; Env: string[] };
    expect(body.Cmd).toEqual(
      expect.arrayContaining([
        '--certificatesresolvers.le-dns.acme.dnschallenge.provider=cloudflare',
        '--certificatesresolvers.le-dns.acme.storage=/letsencrypt/acme-dns.json',
        '--certificatesresolvers.le-dns.acme.email=ops@example.com',
      ]),
    );
    expect(body.Env).toEqual(['CF_DNS_API_TOKEN=tok_secret_value']);
    // The token never appears in the command line (only in Env).
    expect(body.Cmd.join(' ')).not.toContain('tok_secret_value');
  });

  it('leaves the container definition unchanged without a binding or without an ACME email', async () => {
    const plain = setup(null);
    await plain.proxy.provisionOn(plain.docker as never, settings);
    const body = plain.created[0] as { Cmd: string[]; Env?: string[] };
    expect(body.Env).toBeUndefined();
    expect(body.Cmd.join(' ')).not.toContain('le-dns');

    const noEmail = setup({
      provider: 'cloudflare',
      token: 'tok_secret_value',
    });
    await noEmail.proxy.provisionOn(noEmail.docker as never, {
      ...settings,
      acmeEmail: null,
    });
    const b2 = noEmail.created[0] as { Cmd: string[]; Env?: string[] };
    expect(b2.Env).toBeUndefined();
    expect(b2.Cmd.join(' ')).not.toContain('le-dns');
  });
});
