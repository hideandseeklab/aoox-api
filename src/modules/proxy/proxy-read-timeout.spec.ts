import { ProxyService, ProxySettings } from './proxy.service';

const settings: ProxySettings = {
  httpPort: 80,
  httpsPort: 443,
  acmeEmail: null,
  acmeStaging: false,
};
const WEB = '--entrypoints.web.transport.respondingtimeouts.readtimeout=300s';
const SECURE =
  '--entrypoints.websecure.transport.respondingtimeouts.readtimeout=300s';

function make(env: Record<string, string>, existingCmd?: string[]) {
  const created: { Cmd: string[] }[] = [];
  const engine = {
    createVolume: jest.fn().mockResolvedValue(undefined),
    systemInfo: jest.fn().mockResolvedValue({}),
    removeContainer: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn((body: { Cmd: string[] }) => {
      created.push(body);
      return Promise.resolve('new');
    }),
    startContainer: jest.fn().mockResolvedValue(undefined),
    connectNetwork: jest.fn(),
    inspectContainer: jest.fn().mockResolvedValue(
      existingCmd
        ? {
            Config: { Cmd: existingCmd },
            HostConfig: { Binds: [] },
          }
        : null,
    ),
    target: 'local',
  };
  const docker = {
    engine,
    hostDockerSocket: '/var/run/docker.sock',
    ensureImage: jest.fn().mockResolvedValue(undefined),
    ensureNetwork: jest.fn().mockResolvedValue(undefined),
    findContainerByName: jest
      .fn()
      .mockResolvedValue(existingCmd ? { Id: 'old', State: 'running' } : null),
  };
  const proxy = new ProxyService(
    { logConfig: undefined } as never,
    { get: (k: string) => env[k] } as never,
    { credentialsFor: jest.fn().mockResolvedValue(null) } as never,
  );
  return { proxy, docker, created };
}

describe('PROXY_READ_TIMEOUT on the proxy container', () => {
  it('passes the flag for both entrypoints (seconds and duration forms)', async () => {
    for (const raw of ['300', '300s', '5m']) {
      const { proxy, docker, created } = make({ PROXY_READ_TIMEOUT: raw });
      await proxy.provisionOn(docker as never, settings);
      expect(created[0].Cmd).toEqual(expect.arrayContaining([WEB, SECURE]));
    }
  });

  it('passes nothing when unset, empty or invalid, and warns once without throwing', async () => {
    for (const raw of [undefined, '', '  ', 'abc', '0', '90000']) {
      const env: Record<string, string> = {};
      if (raw !== undefined) env.PROXY_READ_TIMEOUT = raw;
      const { proxy, docker, created } = make(env);
      const warn = jest
        .spyOn(
          (proxy as unknown as { logger: { warn: () => void } }).logger,
          'warn',
        )
        .mockImplementation();
      await proxy.provisionOn(docker as never, settings);
      await proxy.provisionOn(docker as never, settings);
      expect(created[0].Cmd.some((c) => c.includes('readtimeout'))).toBe(false);
      expect(created[1].Cmd.some((c) => c.includes('readtimeout'))).toBe(false);
      expect(warn).toHaveBeenCalledTimes(
        ['abc', '0', '90000'].includes(raw ?? '') ? 1 : 0,
      );
    }
  });

  it('is kept by the settingsOf-based recreates (certs upgrade, ACME)', async () => {
    const a = make({ PROXY_READ_TIMEOUT: '300' }, ['--providers.docker=true']);
    await expect(
      a.proxy.upgradeToCustomCerts(a.docker as never, settings),
    ).resolves.toBe(true);
    expect(a.created[0].Cmd).toEqual(expect.arrayContaining([WEB, SECURE]));

    const b = make({ PROXY_READ_TIMEOUT: '300' }, ['--providers.docker=true']);
    await expect(
      b.proxy.recreateWithAcme(b.docker as never, 'ops@example.com', settings),
    ).resolves.toBe(true);
    expect(b.created[0].Cmd).toEqual(expect.arrayContaining([WEB, SECURE]));
  });

  it('reports the running value and the configured one in the status', async () => {
    const running = make({ PROXY_READ_TIMEOUT: '600' }, [WEB, SECURE]);
    const s1 = await running.proxy.statusOn(running.docker as never, settings);
    expect(s1.readTimeout).toBe(300);
    expect(s1.configuredReadTimeout).toBe(600);

    const old = make({}, ['--providers.docker=true']);
    const s2 = await old.proxy.statusOn(old.docker as never, settings);
    expect(s2.readTimeout).toBeNull();
    expect(s2.configuredReadTimeout).toBeNull();

    const none = make({ PROXY_READ_TIMEOUT: '300' });
    const s3 = await none.proxy.statusOn(none.docker as never, settings);
    expect(s3).toMatchObject({
      installed: false,
      readTimeout: null,
      configuredReadTimeout: 300,
    });
  });
});
