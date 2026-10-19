import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger } from '@nestjs/common';
import { utils } from 'ssh2';
import {
  publicKeyLine,
  SshKeyPermissionError,
  SshKeyService,
} from './ssh-key.service';

jest.mock('fs');

// fs is mocked, so nothing is written; these dirs are fake but live under the
// OS temp dir so a path can never resolve to a drive root, and the service's
// "Generated terminal SSH key at ..." log line stays out of the test output.
const KEY_DIR = join(tmpdir(), 'aoox-spec-keys');
const RO_DIR = join(tmpdir(), 'aoox-spec-ro');
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
const mockedFs = jest.mocked(fs);

function config(env: Record<string, string | undefined>) {
  return {
    get: (k: string) => env[k],
    getOrThrow: (k: string) => env[k],
  } as unknown as ConfigService;
}

/** Fake ssh2 keygen so tests stay fast and deterministic. */
const generateSpy = jest
  .spyOn(utils, 'generateKeyPairSync')
  .mockImplementation(() => ({
    private: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n',
    public: 'ssh-ed25519 AAAAfake aoox-terminal',
  }));

describe('SshKeyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false);
  });

  it('generates the keypair once and caches it', () => {
    const svc = new SshKeyService(config({ TERMINAL_SSH_KEY_DIR: KEY_DIR }));
    const first = svc.load();
    const second = svc.load();

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.publicKey).toBe('ssh-ed25519 AAAAfake aoox-terminal');
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(KEY_DIR, {
      recursive: true,
      mode: 0o700,
    });
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      join(KEY_DIR, 'terminal_ssh_key'),
      first.privateKey,
      { mode: 0o600 },
    );
    expect(mockedFs.chmodSync).toHaveBeenCalledWith(
      join(KEY_DIR, 'terminal_ssh_key'),
      0o600,
    );
  });

  it('reuses an existing key instead of regenerating', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation((p) =>
      String(p).endsWith('.pub') ? 'ssh-ed25519 AAAAold x\n' : 'PRIV',
    );
    const svc = new SshKeyService(config({}));

    expect(svc.load()).toEqual({
      privateKey: 'PRIV',
      publicKey: 'ssh-ed25519 AAAAold x',
    });
    expect(generateSpy).not.toHaveBeenCalled();
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('maps EACCES to SshKeyPermissionError', () => {
    mockedFs.mkdirSync.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    });
    const svc = new SshKeyService(config({ TERMINAL_SSH_KEY_DIR: RO_DIR }));
    expect(() => svc.load()).toThrow(SshKeyPermissionError);
  });
});

describe('publicKeyLine', () => {
  it('formats a real key as one authorized_keys line', () => {
    generateSpy.mockRestore();
    const pair = utils.generateKeyPairSync('ed25519', { comment: 'c' });
    const line = publicKeyLine(pair.private);
    expect(line).toBe(pair.public);
    expect(line).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+ c$/);
  });
});
