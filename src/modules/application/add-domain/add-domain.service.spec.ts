import { ConflictException } from '@nestjs/common';
import { AddDomainService } from './add-domain.service';

function makeService(opts: {
  proxyRunning: boolean;
  serverId?: string | null;
}) {
  const app = { id: 'app1', serverId: opts.serverId ?? null };
  const domainsRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };
  const applications = {
    findOwnedOrFail: jest.fn().mockResolvedValue(app),
    domains: domainsRepo,
  };
  const runner = { applyRuntimeConfig: jest.fn().mockResolvedValue(undefined) };
  const proxy = {
    localSettings: {
      httpPort: 80,
      httpsPort: 443,
      acmeEmail: null,
      acmeStaging: false,
    },
    statusOn: jest.fn().mockResolvedValue({ running: opts.proxyRunning }),
    provisionOn: jest.fn().mockResolvedValue(undefined),
  };
  const dockerHandle = { label: 'local' };
  const remote = { forServer: jest.fn().mockResolvedValue(dockerHandle) };
  const servers = {
    findOrFail: jest.fn().mockResolvedValue({
      host: 'server1',
      proxyHttpPort: 8080,
      proxyHttpsPort: 8443,
      acmeEmail: null,
      acmeStaging: false,
    }),
  };
  const service = new AddDomainService(
    applications as never,
    runner as never,
    proxy as never,
    remote as never,
    servers as never,
  );
  return {
    service,
    applications,
    runner,
    proxy,
    remote,
    servers,
    dockerHandle,
  };
}

describe('AddDomainService', () => {
  it('rejects a host already used by another application', async () => {
    const { service, applications } = makeService({ proxyRunning: true });
    applications.domains.findOne.mockResolvedValueOnce({
      id: 'taken',
    });
    await expect(
      service.execute('owner1', 'app1', { host: 'taken.example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not touch a proxy that is already running', async () => {
    const { service, proxy, runner } = makeService({ proxyRunning: true });
    const result = await service.execute('owner1', 'app1', {
      host: 'app.example.com',
    });
    expect(result.proxyAutoProvisioned).toBe(false);
    expect(proxy.provisionOn).not.toHaveBeenCalled();
    expect(runner.applyRuntimeConfig).toHaveBeenCalledTimes(1);
  });

  it('auto-provisions the proxy when it is not running yet', async () => {
    const { service, proxy } = makeService({ proxyRunning: false });
    const result = await service.execute('owner1', 'app1', {
      host: 'app.example.com',
    });
    expect(result.proxyAutoProvisioned).toBe(true);
    expect(proxy.provisionOn).toHaveBeenCalledTimes(1);
  });

  it('checks/provisions the proxy on the app server, not the local host, for a remote app', async () => {
    const { service, proxy, remote, servers, dockerHandle } = makeService({
      proxyRunning: false,
      serverId: 'server1',
    });
    await service.execute('owner1', 'app1', { host: 'app.example.com' });
    expect(remote.forServer).toHaveBeenCalledWith('server1');
    expect(servers.findOrFail).toHaveBeenCalledWith('server1');
    expect(proxy.statusOn).toHaveBeenCalledWith(
      dockerHandle,
      expect.any(Object),
    );
    expect(proxy.provisionOn).toHaveBeenCalledWith(
      dockerHandle,
      expect.any(Object),
    );
  });
});
