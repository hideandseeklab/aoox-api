import {
  bindOfBinding,
  composeHostPrefix,
  hostPortBinding,
  isLoopbackIp,
  isPublicIp,
  normalizeBind,
} from './host-port-bind';

describe('host port bind helpers', () => {
  it('normalizeBind treats anything but "loopback" as public (existing rows, old files)', () => {
    expect(normalizeBind('loopback')).toBe('loopback');
    expect(normalizeBind('public')).toBe('public');
    for (const v of [undefined, null, '', 'Loopback', 'lan', 7]) {
      expect(normalizeBind(v)).toBe('public');
    }
  });

  it('hostPortBinding adds HostIp only for loopback', () => {
    expect(hostPortBinding(8080, 'public')).toEqual({ HostPort: '8080' });
    expect(hostPortBinding(8080)).toEqual({ HostPort: '8080' });
    expect(hostPortBinding(5432, 'loopback')).toEqual({
      HostIp: '127.0.0.1',
      HostPort: '5432',
    });
  });

  it('bindOfBinding reads an inspected binding back', () => {
    expect(bindOfBinding({ HostIp: '127.0.0.1' })).toBe('loopback');
    expect(bindOfBinding({ HostIp: '::1' })).toBe('loopback');
    expect(bindOfBinding({ HostIp: '' })).toBe('public');
    expect(bindOfBinding({ HostIp: '0.0.0.0' })).toBe('public');
    expect(bindOfBinding(undefined)).toBe('public');
  });

  it('composeHostPrefix prefixes the short syntax for loopback only', () => {
    expect(composeHostPrefix('loopback')).toBe('127.0.0.1:');
    expect(composeHostPrefix('public')).toBe('');
    expect(composeHostPrefix(undefined)).toBe('');
  });

  it('classifies container summary IPs', () => {
    expect(isPublicIp('0.0.0.0')).toBe(true);
    expect(isPublicIp('::')).toBe(true);
    expect(isPublicIp(undefined)).toBe(true);
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('10.0.0.5')).toBe(false);
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('::1')).toBe(true);
    expect(isLoopbackIp('0.0.0.0')).toBe(false);
    expect(isLoopbackIp(undefined)).toBe(false);
  });
});
