import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { SshKeyPermissionError, SshKeyService } from '../ssh/ssh-key.service';
import { ServerService } from '../server/server.service';
import { TerminalBackendService } from './terminal-backend.service';

jest.mock('fs');
const sshOpen = jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({});
jest.mock('../ssh/ssh.session', () => ({
  SshSession: { open: (...args: unknown[]) => sshOpen(...args) },
}));
const mockedFs = jest.mocked(fs);

function config(env: Record<string, string | undefined>) {
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

const resolve = jest.fn();
const servers = { resolve } as unknown as ServerService;

describe('TerminalBackendService credential precedence', () => {
  const load = jest.fn(() => ({
    privateKey: 'GEN',
    publicKey: 'ssh-ed25519 GEN',
  }));
  const keys = { load } as unknown as SshKeyService;

  beforeEach(() => jest.clearAllMocks());

  it('is local and never touches the key when TERMINAL_SSH_HOST is empty', () => {
    const svc = new TerminalBackendService(config({}), keys, servers);
    expect(svc.mode).toBe('local');
    expect(svc.status()).toMatchObject({
      mode: 'local',
      publicKey: null,
      authorizeCommand: null,
      error: null,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('falls back to the generated key when no env credential is set', () => {
    const svc = new TerminalBackendService(
      config({ TERMINAL_SSH_HOST: 'host', TERMINAL_SSH_USER: 'root' }),
      keys,
      servers,
    );
    const status = svc.status();
    expect(status.keySource).toBe('generated');
    expect(status.publicKey).toBe('ssh-ed25519 GEN');
    expect(status.authorizeCommand).toContain(
      "echo 'ssh-ed25519 GEN' >> ~/.ssh/authorized_keys",
    );
    expect(status.error).toBeNull();
  });

  it('prefers an explicit password over the generated key', () => {
    const svc = new TerminalBackendService(
      config({
        TERMINAL_SSH_HOST: 'host',
        TERMINAL_SSH_USER: 'root',
        TERMINAL_SSH_PASSWORD: 'pw',
      }),
      keys,
      servers,
    );
    expect(svc.status()).toMatchObject({
      keySource: 'env-password',
      publicKey: null,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('does not fail boot when TERMINAL_SSH_PRIVATE_KEY_FILE is missing', () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: no such file /keys/missing'), {
        code: 'ENOENT',
      });
    });
    const svc = new TerminalBackendService(
      config({
        TERMINAL_SSH_HOST: 'host',
        TERMINAL_SSH_USER: 'root',
        TERMINAL_SSH_PRIVATE_KEY_FILE: '/keys/missing',
      }),
      keys,
      servers,
    );
    expect(svc.keySource).toBe('env-key');
    expect(svc.status().error).toContain('/keys/missing');
    expect(load).not.toHaveBeenCalled();
  });

  it('reports a missing user and key-dir permission problems instead of throwing', () => {
    const svc = new TerminalBackendService(
      config({ TERMINAL_SSH_HOST: 'host' }),
      keys,
      servers,
    );
    expect(svc.status().error).toBe('TERMINAL_SSH_USER is not set');

    const denied = {
      load: jest.fn(() => {
        throw new SshKeyPermissionError('/run/secrets/aoox');
      }),
    } as unknown as SshKeyService;
    const svc2 = new TerminalBackendService(
      config({ TERMINAL_SSH_HOST: 'host', TERMINAL_SSH_USER: 'root' }),
      denied,
      servers,
    );
    expect(svc2.status().error).toContain('sudo chown -R 1000:1000');
  });

  it('opens a remote server by id with its resolved target, even in local mode', async () => {
    const target = {
      host: 'vps',
      port: 22,
      username: 'ubuntu',
      privateKey: 'GEN',
    };
    resolve.mockResolvedValueOnce({
      target,
      usesPlatformKey: true,
      server: {},
    });
    const svc = new TerminalBackendService(config({}), keys, servers);
    await svc.open({ cols: 80, rows: 24 }, 'srv-1');
    expect(resolve).toHaveBeenCalledWith('srv-1');
    expect(sshOpen).toHaveBeenCalledWith(target, {
      cols: 80,
      rows: 24,
    });
  });

  it('authHint names the remote login and, for the platform key, the authorize command', async () => {
    resolve.mockResolvedValueOnce({
      target: { host: 'vps', port: 22, username: 'ubuntu', privateKey: 'GEN' },
      usesPlatformKey: true,
      server: {},
    });
    const svc = new TerminalBackendService(config({}), keys, servers);
    await expect(svc.authHint('srv-1')).resolves.toEqual({
      where: 'ubuntu@vps',
      command: expect.stringContaining("echo 'ssh-ed25519 GEN'") as string,
    });

    resolve.mockResolvedValueOnce({
      target: { host: 'vps', port: 22, username: 'ubuntu', privateKey: 'OWN' },
      usesPlatformKey: false,
      server: {},
    });
    await expect(svc.authHint('srv-1')).resolves.toEqual({
      where: 'ubuntu@vps',
      command: null,
    });
  });
});
