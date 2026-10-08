import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { SshSession } from '../../ssh/ssh.session';
import { AuthorizeTerminalService } from './authorize-terminal.service';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc aoox-terminal';

describe('AuthorizeTerminalService', () => {
  const backend = {
    autoAuthorizeBlocker: jest.fn<string | null, []>(),
    status: jest.fn(() => ({ username: 'ubuntu' })),
    platformTarget: jest.fn(() => ({
      host: 'h',
      port: 22,
      username: 'ubuntu',
    })),
  };
  const keys = { load: jest.fn(() => ({ privateKey: 'p', publicKey: KEY })) };
  const runOnceWithOutput = jest.fn();
  const docker = { ensureImage: jest.fn(), runOnceWithOutput };
  let probe: jest.SpyInstance;
  let svc: AuthorizeTerminalService;

  const account = (home = '/home/ubuntu') => ({
    code: 0,
    output: `2026-10-06T08:00:00Z 1000:1001:${home}\n`,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    backend.autoAuthorizeBlocker.mockReturnValue(null);
    probe = jest.spyOn(SshSession, 'probe').mockResolvedValue(undefined);
    svc = new AuthorizeTerminalService(
      backend as never,
      keys as never,
      docker as never,
    );
  });
  afterEach(() => probe.mockRestore());

  it('refuses with 400 when the backend cannot be auto-authorized', async () => {
    backend.autoAuthorizeBlocker.mockReturnValue('local shell');
    await expect(svc.execute()).rejects.toThrow(BadRequestException);
    expect(runOnceWithOutput).not.toHaveBeenCalled();
  });

  it('looks the account up read-only, then writes the public key with env only', async () => {
    runOnceWithOutput
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce({ code: 0, output: '' });
    const r = await svc.execute();
    expect(r).toEqual({
      ok: true,
      user: 'ubuntu',
      alreadyAuthorized: false,
      verified: true,
      message: 'Key authorized for ubuntu; connection verified.',
    });
    type Call = {
      Env: string[];
      Entrypoint: string[];
      HostConfig: { Mounts: Record<string, unknown>[]; NetworkMode: string };
    };
    const calls = runOnceWithOutput.mock.calls as [Call][];
    const [lookup, write] = [calls[0][0], calls[1][0]];
    expect(lookup.Env).toEqual(['AOOX_USER=ubuntu']);
    expect(lookup.HostConfig.Mounts[0]).toMatchObject({
      Source: '/etc/passwd',
      ReadOnly: true,
    });
    expect(write.Env).toEqual([
      `KEY=${KEY}`,
      'OWNER_UID=1000',
      'OWNER_GID=1001',
    ]);
    expect(write.HostConfig.Mounts).toEqual([
      { Type: 'bind', Source: '/home/ubuntu', Target: '/target' },
    ]);
    // Nothing user-controlled in the command strings.
    for (const call of [lookup, write]) {
      expect(call.Entrypoint.join(' ')).not.toContain('ubuntu');
      expect(call.Entrypoint.join(' ')).not.toContain('ssh-ed25519');
      expect(call.HostConfig.NetworkMode).toBe('none');
    }
  });

  it('is idempotent: an existing key reports alreadyAuthorized', async () => {
    runOnceWithOutput
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce({ code: 10, output: '' });
    const r = await svc.execute();
    expect(r.alreadyAuthorized).toBe(true);
    expect(r.message).toBe(
      'Key was already authorized for ubuntu; connection verified.',
    );
  });

  it('reports a failed connection test without failing the call', async () => {
    runOnceWithOutput
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce({ code: 0, output: '' });
    probe.mockRejectedValue(
      Object.assign(new Error('rejected'), { level: 'client-authentication' }),
    );
    const r = await svc.execute();
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.message).toMatch(
      /Key authorized for ubuntu but the connection test failed: the host still rejects/,
    );

    probe.mockRejectedValue(new Error('connect ECONNREFUSED'));
    runOnceWithOutput
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce({ code: 0, output: '' });
    expect((await svc.execute()).message).toContain('ECONNREFUSED');
  });

  it('400 when the user is not in passwd or the home is unusable', async () => {
    runOnceWithOutput.mockResolvedValueOnce({ code: 4, output: '' });
    await expect(svc.execute()).rejects.toThrow(/does not exist on the host/);

    runOnceWithOutput.mockResolvedValueOnce(account('/'));
    await expect(svc.execute()).rejects.toThrow(/not usable/);
    runOnceWithOutput.mockResolvedValueOnce(account('/home/a b'));
    await expect(svc.execute()).rejects.toThrow(BadRequestException);
    expect(runOnceWithOutput).toHaveBeenCalledTimes(3);
  });

  it('400 on a symlinked .ssh, 502 on other helper failures', async () => {
    runOnceWithOutput
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce({ code: 3, output: '' });
    await expect(svc.execute()).rejects.toThrow(/symlink/);

    runOnceWithOutput
      .mockResolvedValueOnce(account())
      .mockResolvedValueOnce({ code: 1, output: '' });
    await expect(svc.execute()).rejects.toThrow(BadGatewayException);

    runOnceWithOutput.mockRejectedValueOnce(new Error('docker down'));
    await expect(svc.execute()).rejects.toThrow(BadGatewayException);
  });
});
