import { NotFoundException } from '@nestjs/common';
import { SshKeyService } from '../../ssh/ssh-key.service';
import { RemoteDockerService } from '../remote-docker.service';
import { ServerService } from '../server.service';
import { TestServerService } from './test-server.service';

const sshOpen = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../../ssh/ssh.session', () => ({
  SshSession: { open: (...args: unknown[]) => sshOpen(...args) },
}));

describe('TestServerService', () => {
  const resolve = jest.fn();
  const servers = { resolve } as unknown as ServerService;
  const keys = {
    load: () => ({ privateKey: 'GEN', publicKey: 'ssh-ed25519 GEN' }),
  } as unknown as SshKeyService;
  const remote = {
    forget: jest.fn(),
    forServer: jest.fn().mockResolvedValue({
      engine: {
        systemInfo: () => Promise.resolve({ ServerVersion: '29.8.0' }),
      },
    }),
  } as unknown as RemoteDockerService;
  const svc = new TestServerService(servers, keys, remote);
  const target = { host: 'vps', port: 22, username: 'ubuntu', privateKey: 'x' };

  beforeEach(() => jest.clearAllMocks());

  it('reports success and closes the probe shell', async () => {
    const kill = jest.fn();
    resolve.mockResolvedValue({ target, usesPlatformKey: true, server: {} });
    sshOpen.mockResolvedValue({ kill });

    await expect(svc.execute('s1')).resolves.toEqual({
      ok: true,
      message: 'Connected as ubuntu@vps:22; Docker 29.8.0 reachable',
      authorizeCommand: null,
      dockerVersion: '29.8.0',
      dockerError: null,
    });
    expect(kill).toHaveBeenCalled();
  });

  it('returns the authorize command when the platform key is rejected', async () => {
    resolve.mockResolvedValue({ target, usesPlatformKey: true, server: {} });
    sshOpen.mockRejectedValue(
      Object.assign(new Error('auth'), { level: 'client-authentication' }),
    );
    const r = await svc.execute('s1');
    expect(r.ok).toBe(false);
    expect(r.authorizeCommand).toContain("echo 'ssh-ed25519 GEN'");
  });

  it('gives no authorize command for a server with its own key', async () => {
    resolve.mockResolvedValue({ target, usesPlatformKey: false, server: {} });
    sshOpen.mockRejectedValue(
      Object.assign(new Error('auth'), { level: 'client-authentication' }),
    );
    const r = await svc.execute('s1');
    expect(r).toMatchObject({ ok: false, authorizeCommand: null });
  });

  it('distinguishes network errors and missing servers', async () => {
    resolve.mockResolvedValue({ target, usesPlatformKey: true, server: {} });
    sshOpen.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(svc.execute('s1')).resolves.toMatchObject({
      ok: false,
      message: 'Cannot reach ubuntu@vps:22: ECONNREFUSED',
    });

    resolve.mockRejectedValue(new NotFoundException('Server not found'));
    await expect(svc.execute('nope')).resolves.toMatchObject({
      ok: false,
      message: 'Server not found',
    });
  });
});
