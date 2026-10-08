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

  it('defaults the login to root when TERMINAL_SSH_USER is empty or missing (installs older than the installer default)', async () => {
    for (const env of [
      { TERMINAL_SSH_HOST: 'host' },
      { TERMINAL_SSH_HOST: 'host', TERMINAL_SSH_USER: '' },
      { TERMINAL_SSH_HOST: 'host', TERMINAL_SSH_USER: '   ' },
    ]) {
      const svc = new TerminalBackendService(config(env), keys, servers);
      expect(svc.status()).toMatchObject({
        username: 'root',
        usernameSource: 'default',
        error: null,
      });
      await svc.open({ cols: 80, rows: 24 });
      expect(sshOpen).toHaveBeenLastCalledWith(
        expect.objectContaining({ host: 'host', username: 'root' }),
        { cols: 80, rows: 24 },
      );
    }
  });

  it('keeps an explicit TERMINAL_SSH_USER and reports its source', () => {
    const svc = new TerminalBackendService(
      config({ TERMINAL_SSH_HOST: 'host', TERMINAL_SSH_USER: ' deploy ' }),
      keys,
      servers,
    );
    expect(svc.status()).toMatchObject({
      username: 'deploy',
      usernameSource: 'env',
    });
  });

  it('has no username source in local mode', () => {
    const svc = new TerminalBackendService(config({}), keys, servers);
    expect(svc.status()).toMatchObject({
      username: null,
      usernameSource: null,
    });
  });

  it('never applies the default to a remote server, which keeps its own username', async () => {
    resolve.mockResolvedValueOnce({
      target: { host: 'vps', port: 22, username: 'ubuntu' },
      usesPlatformKey: false,
      server: {},
    });
    const svc = new TerminalBackendService(
      config({ TERMINAL_SSH_HOST: 'host' }),
      keys,
      servers,
    );
    await svc.open({ cols: 80, rows: 24 }, 'srv-1');
    expect(sshOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: 'ubuntu' }),
      expect.anything(),
    );
  });

  it('reports key-dir permission problems instead of throwing', () => {
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
      username: 'ubuntu',
      command: expect.stringContaining("echo 'ssh-ed25519 GEN'") as string,
    });

    resolve.mockResolvedValueOnce({
      target: { host: 'vps', port: 22, username: 'ubuntu', privateKey: 'OWN' },
      usesPlatformKey: false,
      server: {},
    });
    await expect(svc.authHint('srv-1')).resolves.toEqual({
      where: 'ubuntu@vps',
      username: 'ubuntu',
      command: null,
    });
  });

  it('status names the account to authorize as, with the root caveat only for root', () => {
    const asRoot = new TerminalBackendService(
      config({ TERMINAL_SSH_HOST: 'host' }),
      keys,
      servers,
    ).status();
    expect(asRoot.username).toBe('root');
    expect(asRoot.authorizeCommand).toContain("echo 'ssh-ed25519 GEN'");
    expect(asRoot.authorizeNote).toContain('as root');
    expect(asRoot.authorizeNote).toContain('PermitRootLogin');
    expect(asRoot.authorizeNote).toContain('Infrastructure > Environment');

    const asUbuntu = new TerminalBackendService(
      config({ TERMINAL_SSH_HOST: 'host', TERMINAL_SSH_USER: 'ubuntu' }),
      keys,
      servers,
    ).status();
    expect(asUbuntu.authorizeNote).toContain('as ubuntu');
    expect(asUbuntu.authorizeNote).not.toContain('PermitRootLogin');
    // The command itself stays a single line the web can copy as-is.
    expect(asUbuntu.authorizeCommand).not.toContain('\n');
  });

  it('canAutoAuthorize only for the generated key against the Docker host with a valid login', () => {
    const status = (env: Record<string, string>) =>
      new TerminalBackendService(config(env), keys, servers);
    const ok = status({ TERMINAL_SSH_HOST: 'host.docker.internal' });
    expect(ok.autoAuthorizeBlocker()).toBeNull();
    expect(ok.status().canAutoAuthorize).toBe(true);
    expect(
      status({
        TERMINAL_SSH_HOST: '172.17.0.1',
        TERMINAL_SSH_USER: 'ubuntu',
      }).status().canAutoAuthorize,
    ).toBe(true);

    const no = (env: Record<string, string>) =>
      status(env).status().canAutoAuthorize;
    expect(no({})).toBe(false); // local pty
    expect(
      no({
        TERMINAL_SSH_HOST: 'host.docker.internal',
        TERMINAL_SSH_PASSWORD: 'pw',
      }),
    ).toBe(false);
    expect(
      no({
        TERMINAL_SSH_HOST: 'host.docker.internal',
        TERMINAL_SSH_PRIVATE_KEY: 'k',
      }),
    ).toBe(false);
    expect(no({ TERMINAL_SSH_HOST: '203.0.113.9' })).toBe(false);
    expect(
      no({ TERMINAL_SSH_HOST: 'localhost', TERMINAL_SSH_USER: 'a b' }),
    ).toBe(false);
    expect(
      status({ TERMINAL_SSH_HOST: '203.0.113.9' }).autoAuthorizeBlocker(),
    ).toContain('not the Docker host');
  });

  it('status has no note without an authorize command (local mode, password auth)', () => {
    expect(
      new TerminalBackendService(config({}), keys, servers).status()
        .authorizeNote,
    ).toBeNull();
    expect(
      new TerminalBackendService(
        config({ TERMINAL_SSH_HOST: 'host', TERMINAL_SSH_PASSWORD: 'pw' }),
        keys,
        servers,
      ).status().authorizeNote,
    ).toBeNull();
  });
});
