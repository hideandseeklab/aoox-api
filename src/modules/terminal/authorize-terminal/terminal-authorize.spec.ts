import {
  isLocalSshHost,
  isValidHome,
  isValidKeyLine,
  isValidLoginName,
  LOOKUP_SCRIPT,
  parseAccountOutput,
  WRITE_SCRIPT,
} from './terminal-authorize';

describe('terminal-authorize', () => {
  it('treats only the Docker host as local', () => {
    for (const h of [
      'host.docker.internal',
      'localhost',
      '127.0.0.1',
      '172.17.0.1',
      ' LOCALHOST ',
    ]) {
      expect(isLocalSshHost(h)).toBe(true);
    }
    for (const h of ['203.0.113.5', 'example.com', '10.0.0.2', '']) {
      expect(isLocalSshHost(h)).toBe(false);
    }
  });

  it('accepts plain login names only', () => {
    expect(isValidLoginName('ubuntu')).toBe(true);
    expect(isValidLoginName('deploy-1')).toBe(true);
    for (const bad of [
      '',
      'a b',
      'a;b',
      '../x',
      'a\nb',
      '1abc',
      'x'.repeat(40),
    ]) {
      expect(isValidLoginName(bad)).toBe(false);
    }
  });

  it('accepts only sane absolute home directories', () => {
    expect(isValidHome('/home/ubuntu')).toBe(true);
    expect(isValidHome('/root')).toBe(true);
    for (const bad of [
      '/',
      '',
      'home/x',
      '/home/../etc',
      '/home/a b',
      '/home/x/',
      '/home/x\ny',
      '/home/$(id)',
    ]) {
      expect(isValidHome(bad)).toBe(false);
    }
  });

  it('accepts a single authorized_keys line and nothing else', () => {
    expect(
      isValidKeyLine('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc aoox-terminal'),
    ).toBe(true);
    expect(isValidKeyLine('ssh-ed25519 AAAAC3Nza')).toBe(true);
    expect(isValidKeyLine("ssh-ed25519 AAAA'; rm -rf / #")).toBe(false);
    expect(isValidKeyLine('ssh-ed25519 AAAA x\nssh-rsa BBBB y')).toBe(false);
    expect(isValidKeyLine('echo hi')).toBe(false);
  });

  it('parses the helper output, also behind an Engine log timestamp', () => {
    expect(parseAccountOutput('1000:1001:/home/ubuntu\n')).toEqual({
      uid: 1000,
      gid: 1001,
      home: '/home/ubuntu',
    });
    expect(
      parseAccountOutput('2026-10-06T08:00:00.123456789Z 0:0:/root\n'),
    ).toEqual({ uid: 0, gid: 0, home: '/root' });
    expect(parseAccountOutput('')).toBeNull();
    expect(parseAccountOutput('garbage\n')).toBeNull();
  });

  it('keeps user values out of the scripts', () => {
    expect(LOOKUP_SCRIPT).toContain('ENVIRON["AOOX_USER"]');
    for (const v of ['$KEY', '$OWNER_UID', '$OWNER_GID']) {
      expect(WRITE_SCRIPT).toContain(v);
    }
    expect(WRITE_SCRIPT).toContain('grep -qxF');
    expect(WRITE_SCRIPT).toContain('chmod 700');
    expect(WRITE_SCRIPT).toContain('chmod 600');
    expect(WRITE_SCRIPT).not.toContain('chown -R');
  });
});
