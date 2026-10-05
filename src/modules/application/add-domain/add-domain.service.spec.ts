import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
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
    remove: jest.fn().mockResolvedValue(undefined),
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
  const certs = {
    findOrFail: jest.fn(),
    assertCovers: jest.fn(),
  };
  const certSync = { sync: jest.fn().mockResolvedValue(undefined) };
  const service = new AddDomainService(
    applications as never,
    runner as never,
    proxy as never,
    remote as never,
    servers as never,
    certs as never,
    certSync as never,
  );
  return {
    certs,
    certSync,
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

describe('AddDomainService with a custom certificate', () => {
  const CERT = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'wildcard',
    domains: ['*.example.com'],
  };

  it('saves the assignment, syncs the proxy volume before the labels are applied, and names the certificate', async () => {
    const { service, applications, certs, certSync, runner, dockerHandle } =
      makeService({ proxyRunning: true });
    certs.findOrFail.mockResolvedValue(CERT);
    const order: string[] = [];
    certSync.sync.mockImplementation(() => {
      order.push('sync');
      return Promise.resolve({ certificates: 1, proxyRecreated: false });
    });
    runner.applyRuntimeConfig.mockImplementation(() => {
      order.push('apply');
      return Promise.resolve();
    });
    const result = await service.execute('owner1', 'app1', {
      host: 'App.Example.com',
      https: true,
      certificateId: CERT.id,
    });
    expect(certs.assertCovers).toHaveBeenCalledWith(
      ['app.example.com'],
      CERT.domains,
    );
    expect(applications.domains.create).toHaveBeenCalledWith(
      expect.objectContaining({ certificateId: CERT.id, https: true }),
    );
    expect(certSync.sync).toHaveBeenCalledWith(
      dockerHandle,
      expect.any(Object),
      null,
    );
    expect(order).toEqual(['sync', 'apply']);
    expect(result.domain).toMatchObject({
      host: 'app.example.com',
      certificateId: CERT.id,
      certificateName: 'wildcard',
    });
  });

  it('removes the new domain and answers 502 when the certificate cannot be written (no half-applied router)', async () => {
    const { service, applications, certs, certSync, runner } = makeService({
      proxyRunning: true,
    });
    certs.findOrFail.mockResolvedValue(CERT);
    certSync.sync.mockRejectedValue(new Error('ssh down'));
    await expect(
      service.execute('owner1', 'app1', {
        host: 'app.example.com',
        https: true,
        certificateId: CERT.id,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(applications.domains.remove).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'app.example.com' }),
    );
    expect(runner.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it('refuses a certificate on a plain-http domain and saves nothing', async () => {
    const { service, applications, certs } = makeService({
      proxyRunning: true,
    });
    certs.findOrFail.mockResolvedValue(CERT);
    await expect(
      service.execute('owner1', 'app1', {
        host: 'app.example.com',
        certificateId: CERT.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(applications.domains.save).not.toHaveBeenCalled();
  });

  it('refuses a certificate that does not cover the host and saves nothing', async () => {
    const { service, applications, certs } = makeService({
      proxyRunning: true,
    });
    certs.findOrFail.mockResolvedValue(CERT);
    certs.assertCovers.mockImplementation(() => {
      throw new BadRequestException('does not cover');
    });
    await expect(
      service.execute('owner1', 'app1', {
        host: 'a.b.example.com',
        https: true,
        certificateId: CERT.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(applications.domains.save).not.toHaveBeenCalled();
  });

  it('does not touch the certificate machinery for a normal domain', async () => {
    const { service, certs, certSync } = makeService({ proxyRunning: true });
    const result = await service.execute('owner1', 'app1', {
      host: 'plain.example.com',
      https: true,
      certificateId: '',
    });
    expect(certs.findOrFail).not.toHaveBeenCalled();
    expect(certSync.sync).not.toHaveBeenCalled();
    expect(result.domain).toMatchObject({
      certificateId: null,
      certificateName: null,
    });
  });
});
