import { ConfigService } from '@nestjs/config';
import { DockerService } from '../docker/docker.service';
import { ProxyService } from '../proxy/proxy.service';
import { PanelDomainSettings } from './panel-domain-settings.entity';
import { PanelDomainService } from './panel-domain.service';

jest.mock('../docker/compose-apply.util', () => ({
  ...jest.requireActual<typeof import('../docker/compose-apply.util')>(
    '../docker/compose-apply.util',
  ),
  runComposeHelper: jest.fn().mockResolvedValue(undefined),
}));

const ACME = (email: string) =>
  `--certificatesresolvers.le.acme.email=${email}`;
const settings = {
  httpPort: 80,
  httpsPort: 443,
  acmeEmail: null,
  acmeStaging: false,
  serverId: null,
};

describe('ProxyService ACME recreate decision', () => {
  it('needs a recreate without the resolver or with another email only', () => {
    expect(ProxyService.needsAcmeRecreate(null, 'me@example.com')).toBe(true);
    expect(
      ProxyService.needsAcmeRecreate('old@example.com', 'me@example.com'),
    ).toBe(true);
    // idempotent re-save, and no email asked: leave the proxy alone
    expect(
      ProxyService.needsAcmeRecreate('me@example.com', 'me@example.com'),
    ).toBe(false);
    expect(ProxyService.needsAcmeRecreate('me@example.com', null)).toBe(false);
    expect(ProxyService.needsAcmeRecreate(null, null)).toBe(false);
  });

  it('reads the email back from the container command', () => {
    expect(ProxyService.acmeEmailOf({ Config: { Cmd: [ACME('a@b.c')] } })).toBe(
      'a@b.c',
    );
    expect(ProxyService.acmeEmailOf({ Config: { Cmd: [] } })).toBeNull();
  });

  function build(inspect: unknown, state = 'running') {
    const docker = {
      engine: {
        inspectContainer: jest.fn().mockResolvedValue(inspect),
        target: 'local',
      },
      findContainerByName: jest
        .fn()
        .mockResolvedValue(
          inspect === null ? null : { Id: 'p1', State: state },
        ),
    };
    const proxy = new ProxyService(
      {} as never,
      { get: jest.fn() } as never,
      { credentialsFor: jest.fn() } as never,
    );
    const provisionOn = jest
      .spyOn(proxy, 'provisionOn')
      .mockResolvedValue(undefined);
    return { proxy, docker, provisionOn };
  }

  it('recreates once with the new email, keeping ports and staging', async () => {
    const { proxy, docker, provisionOn } = build({
      Config: {
        Cmd: ['--certificatesresolvers.le.acme.caserver=https://x/staging'],
      },
      HostConfig: { PortBindings: { '80/tcp': [{ HostPort: '8088' }] } },
    });
    await expect(
      proxy.acmeRecreateNeeded(docker as never, 'me@example.com'),
    ).resolves.toBe(true);
    await expect(
      proxy.recreateWithAcme(docker as never, 'me@example.com', settings),
    ).resolves.toBe(true);
    expect(provisionOn).toHaveBeenCalledWith(docker, {
      httpPort: 8088,
      httpsPort: 443,
      acmeEmail: 'me@example.com',
      acmeStaging: true,
      serverId: null,
    });
  });

  it('does nothing when it matches, is stopped or missing; recreates on an email change', async () => {
    const same = build({ Config: { Cmd: [ACME('me@example.com')] } });
    await expect(
      same.proxy.acmeRecreateNeeded(same.docker as never, 'me@example.com'),
    ).resolves.toBe(false);
    await expect(
      same.proxy.recreateWithAcme(
        same.docker as never,
        'me@example.com',
        settings,
      ),
    ).resolves.toBe(false);
    expect(same.provisionOn).not.toHaveBeenCalled();

    const stopped = build({ Config: { Cmd: [] } }, 'exited');
    await expect(
      stopped.proxy.recreateWithAcme(
        stopped.docker as never,
        'me@example.com',
        settings,
      ),
    ).resolves.toBe(false);
    const none = build(null);
    await expect(
      none.proxy.acmeRecreateNeeded(none.docker as never, 'me@example.com'),
    ).resolves.toBe(false);

    const changed = build({ Config: { Cmd: [ACME('old@example.com')] } });
    await expect(
      changed.proxy.recreateWithAcme(
        changed.docker as never,
        'new@example.com',
        settings,
      ),
    ).resolves.toBe(true);
    expect(changed.provisionOn).toHaveBeenCalledWith(
      changed.docker,
      expect.objectContaining({ acmeEmail: 'new@example.com' }),
    );
  });
});

describe('PanelDomainService ACME on a running proxy', () => {
  function build(drift: boolean, stored: Partial<PanelDomainSettings> = {}) {
    const row = {
      id: 'default',
      webHost: null,
      apiHost: null,
      acmeEmail: null,
      restrictPorts: false,
      ...stored,
    } as PanelDomainSettings;
    const repo = {
      findOne: jest.fn(() => Promise.resolve(row)),
      create: jest.fn((v: object) => v),
      merge: jest.fn((a: object, b: object) => ({ ...a, ...b })),
      save: jest.fn((v: PanelDomainSettings) => Promise.resolve(v)),
    };
    const proxy = {
      status: jest.fn(() => Promise.resolve({ running: true })),
      acmeRecreateNeeded: jest.fn(() => Promise.resolve(drift)),
      recreateWithAcme: jest.fn(() => Promise.resolve(drift)),
      provisionOn: jest.fn(),
      localSettings: settings,
      httpPort: 80,
      httpsPort: 443,
    };
    const config = {
      get: jest.fn((k: string) =>
        k === 'INSTALL_DIR' ? '/opt/aoox' : undefined,
      ),
    };
    const service = new PanelDomainService(
      repo as never,
      {} as DockerService,
      config as unknown as ConfigService,
      proxy as unknown as ProxyService,
    );
    return { service, proxy };
  }
  const dto = { webHost: 'p.example.com', apiHost: 'a.example.com' };

  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reports proxyRecreated when the running proxy lacks the resolver', async () => {
    const { service, proxy } = build(true);
    const r = await service.update({ ...dto, acmeEmail: 'me@example.com' });
    expect(r.proxyRecreated).toBe(true);
    expect(r.proxyAutoProvisioned).toBe(false);
    expect(proxy.acmeRecreateNeeded).toHaveBeenCalledWith(
      expect.anything(),
      'me@example.com',
    );
  });

  it('uses the stored email when none is sent, and never flags a matching proxy', async () => {
    const { service, proxy } = build(false, { acmeEmail: 'me@example.com' });
    const r = await service.update(dto);
    expect(r.proxyRecreated).toBe(false);
    expect(proxy.acmeRecreateNeeded).toHaveBeenCalledWith(
      expect.anything(),
      'me@example.com',
    );
  });

  it('apply recreates only with an email, and never provisions a running proxy', async () => {
    const { service, proxy } = build(true);
    const applier = service as unknown as {
      apply: (s: object, d: string) => Promise<void>;
    };
    const apply = (s: object, d: string) => applier.apply(s, d);
    await apply(
      { ...dto, acmeEmail: 'me@example.com', restrictPorts: false },
      '/opt/aoox',
    );
    expect(proxy.recreateWithAcme).toHaveBeenCalledWith(
      expect.anything(),
      'me@example.com',
      settings,
    );
    expect(proxy.provisionOn).not.toHaveBeenCalled();

    proxy.recreateWithAcme.mockClear();
    await apply({ ...dto, acmeEmail: null, restrictPorts: false }, '/opt/aoox');
    expect(proxy.recreateWithAcme).not.toHaveBeenCalled();
  });
});
