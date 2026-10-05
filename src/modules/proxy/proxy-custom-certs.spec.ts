import { ProxyService, ProxySettings } from './proxy.service';

const acme = { httpsPort: 443, acme: true };
const noAcme = { httpsPort: 443, acme: false };

describe('ProxyService.buildLabels with a custom certificate', () => {
  it('serves the host on a websecure router with tls=true and NO certresolver', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [{ host: 'a.example.com', https: true, customCert: true }],
      acme,
    );
    expect(labels).toMatchObject({
      'traefik.http.routers.app-secure-custom.rule': 'Host(`a.example.com`)',
      'traefik.http.routers.app-secure-custom.entrypoints': 'websecure',
      'traefik.http.routers.app-secure-custom.service': 'app',
      'traefik.http.routers.app-secure-custom.tls': 'true',
    });
    // Never asked of ACME, and no ACME router for this host at all.
    expect(
      Object.keys(labels).filter((k) => k.includes('certresolver')),
    ).toEqual([]);
    expect(labels).not.toHaveProperty('traefik.http.routers.app-secure.rule');
  });

  it('redirects http to https for a custom-certificate host even when ACME is off', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [{ host: 'a.example.com', https: true, customCert: true }],
      noAcme,
    );
    expect(labels).toMatchObject({
      'traefik.http.routers.app-redirect.rule': 'Host(`a.example.com`)',
      'traefik.http.routers.app-redirect.entrypoints': 'web',
      'traefik.http.routers.app-redirect.middlewares': 'app-https@docker',
      'traefik.http.middlewares.app-https.redirectscheme.scheme': 'https',
    });
    // No plain router left: the host is https only.
    expect(labels).not.toHaveProperty('traefik.http.routers.app.rule');
  });

  it('keeps ACME hosts, custom hosts and plain hosts apart', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [
        { host: 'plain.example.com', https: false },
        { host: 'auto.example.com', https: true },
        { host: 'own.example.com', https: true, customCert: true },
      ],
      acme,
    );
    expect(labels['traefik.http.routers.app.rule']).toBe(
      'Host(`plain.example.com`)',
    );
    expect(labels['traefik.http.routers.app-secure.rule']).toBe(
      'Host(`auto.example.com`)',
    );
    expect(labels['traefik.http.routers.app-secure.tls.certresolver']).toBe(
      'le',
    );
    expect(labels['traefik.http.routers.app-secure-custom.rule']).toBe(
      'Host(`own.example.com`)',
    );
    expect(labels['traefik.http.routers.app-redirect.rule']).toBe(
      'Host(`auto.example.com`) || Host(`own.example.com`)',
    );
  });

  it('without ACME only the custom host is redirected; the ACME-less https host stays reachable on http (previous behaviour)', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [
        { host: 'auto.example.com', https: true },
        { host: 'own.example.com', https: true, customCert: true },
      ],
      noAcme,
    );
    expect(labels['traefik.http.routers.app.rule']).toBe(
      'Host(`auto.example.com`)',
    );
    expect(labels['traefik.http.routers.app-redirect.rule']).toBe(
      'Host(`own.example.com`)',
    );
  });

  it('ignores customCert on a host that is not https', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [{ host: 'a.example.com', https: false, customCert: true }],
      acme,
    );
    expect(Object.keys(labels).some((k) => k.includes('-secure'))).toBe(false);
    expect(labels['traefik.http.routers.app.rule']).toBe(
      'Host(`a.example.com`)',
    );
  });
});

describe('ProxyService custom certificate support', () => {
  const settings: ProxySettings = {
    httpPort: 80,
    httpsPort: 443,
    acmeEmail: null,
    acmeStaging: false,
  };
  const supported = {
    Config: {
      Cmd: [
        '--providers.file.directory=/etc/traefik/dynamic',
        '--providers.file.watch=true',
      ],
    },
    HostConfig: { Binds: ['aoox_proxy_certs:/etc/traefik/dynamic'] },
  };

  it('recognizes a proxy that has the file provider and the cert volume', () => {
    expect(ProxyService.supportsCustomCerts(supported)).toBe(true);
    expect(
      ProxyService.supportsCustomCerts({
        Config: { Cmd: ['--providers.docker=true'] },
        HostConfig: { Binds: ['aoox_proxy_acme:/letsencrypt'] },
      }),
    ).toBe(false);
    // Flag without the volume (or the reverse) is not enough.
    expect(
      ProxyService.supportsCustomCerts({
        Config: supported.Config,
        HostConfig: { Binds: [] },
      }),
    ).toBe(false);
    expect(
      ProxyService.supportsCustomCerts({
        Config: { Cmd: null },
        HostConfig: supported.HostConfig,
      }),
    ).toBe(false);
  });

  it('reads the settings a proxy runs with back from its container', () => {
    expect(
      ProxyService.settingsOf(
        {
          Config: {
            Cmd: [
              '--certificatesresolvers.le.acme.email=ops@example.com',
              '--certificatesresolvers.le.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory',
            ],
          },
          HostConfig: {
            PortBindings: {
              '80/tcp': [{ HostPort: '8088' }],
              '443/tcp': [{ HostPort: '8443' }],
            },
          },
        },
        settings,
      ),
    ).toEqual({
      httpPort: 8088,
      httpsPort: 8443,
      acmeEmail: 'ops@example.com',
      acmeStaging: true,
    });
    // No ACME flags, no bindings: ACME stays off and ports fall back.
    expect(ProxyService.settingsOf({ Config: { Cmd: [] } }, settings)).toEqual(
      settings,
    );
  });

  function build(inspect: unknown, state = 'running') {
    const engine = {
      inspectContainer: jest.fn().mockResolvedValue(inspect),
      target: 'local',
    };
    const docker = {
      engine,
      findContainerByName: jest
        .fn()
        .mockResolvedValue(
          inspect === null ? null : { Id: 'proxy1', State: state },
        ),
    };
    const proxy = new ProxyService({} as never, { get: jest.fn() } as never);
    const provisionOn = jest
      .spyOn(proxy, 'provisionOn')
      .mockResolvedValue(undefined);
    return { proxy, docker, provisionOn };
  }

  it('recreates an old running proxy once, with the settings it already runs with', async () => {
    const { proxy, docker, provisionOn } = build({
      Config: {
        Cmd: ['--certificatesresolvers.le.acme.email=ops@example.com'],
      },
      HostConfig: {
        Binds: ['aoox_proxy_acme:/letsencrypt'],
        PortBindings: { '80/tcp': [{ HostPort: '8088' }] },
      },
    });
    await expect(
      proxy.upgradeToCustomCerts(docker as never, settings),
    ).resolves.toBe(true);
    expect(provisionOn).toHaveBeenCalledWith(
      docker,
      expect.objectContaining({ httpPort: 8088, acmeEmail: 'ops@example.com' }),
    );
  });

  it('leaves a proxy that already supports certificates, a stopped one and a missing one alone', async () => {
    const ok = build(supported);
    await expect(
      ok.proxy.upgradeToCustomCerts(ok.docker as never, settings),
    ).resolves.toBe(false);
    expect(ok.provisionOn).not.toHaveBeenCalled();

    const stopped = build({ Config: { Cmd: [] } }, 'exited');
    await expect(
      stopped.proxy.upgradeToCustomCerts(stopped.docker as never, settings),
    ).resolves.toBe(false);
    expect(stopped.provisionOn).not.toHaveBeenCalled();

    const none = build(null);
    await expect(
      none.proxy.upgradeToCustomCerts(none.docker as never, settings),
    ).resolves.toBe(false);
  });

  it('reports customCerts in the status', async () => {
    const { proxy, docker } = build(supported);
    const status = await proxy.statusOn(docker as never, settings);
    expect(status).toMatchObject({
      installed: true,
      running: true,
      customCerts: true,
    });
    const old = build({ Config: { Cmd: [] } });
    expect(
      (await old.proxy.statusOn(old.docker as never, settings)).customCerts,
    ).toBe(false);
  });

  it('provisions with the file provider and the certs volume', async () => {
    const created: unknown[] = [];
    const engine = {
      createVolume: jest.fn().mockResolvedValue(undefined),
      systemInfo: jest.fn().mockResolvedValue({}),
      removeContainer: jest.fn(),
      createContainer: jest.fn((body: unknown) => {
        created.push(body);
        return Promise.resolve('new');
      }),
      startContainer: jest.fn().mockResolvedValue(undefined),
      connectNetwork: jest.fn(),
      target: 'local',
    };
    const docker = {
      engine,
      hostDockerSocket: '/var/run/docker.sock',
      ensureImage: jest.fn().mockResolvedValue(undefined),
      ensureNetwork: jest.fn().mockResolvedValue(undefined),
      findContainerByName: jest.fn().mockResolvedValue(null),
    };
    const proxy = new ProxyService(
      { logConfig: undefined } as never,
      { get: jest.fn() } as never,
    );
    await proxy.provisionOn(docker as never, settings);
    expect(engine.createVolume).toHaveBeenCalledWith('aoox_proxy_certs');
    const body = created[0] as {
      Cmd: string[];
      HostConfig: { Binds: string[] };
    };
    expect(body.Cmd).toEqual(
      expect.arrayContaining([
        '--providers.file.directory=/etc/traefik/dynamic',
        '--providers.file.watch=true',
      ]),
    );
    expect(body.HostConfig.Binds).toEqual(
      expect.arrayContaining([
        'aoox_proxy_certs:/etc/traefik/dynamic',
        'aoox_proxy_acme:/letsencrypt',
      ]),
    );
  });
});
