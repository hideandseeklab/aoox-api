import { ipInCidr, isGithubHookIp } from './webhook-ip-allowlist';

describe('ipInCidr', () => {
  it('matches an IPv4 address inside the range', () => {
    expect(ipInCidr('192.30.252.5', '192.30.252.0/22')).toBe(true);
    expect(ipInCidr('192.30.255.255', '192.30.252.0/22')).toBe(true);
  });

  it('rejects an IPv4 address outside the range', () => {
    expect(ipInCidr('192.31.0.1', '192.30.252.0/22')).toBe(false);
    expect(ipInCidr('192.30.251.255', '192.30.252.0/22')).toBe(false);
  });

  it('matches a /32 exactly and nothing else', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.5/32')).toBe(true);
    expect(ipInCidr('10.0.0.6', '10.0.0.5/32')).toBe(false);
  });

  it('matches an IPv6 address inside the range', () => {
    expect(ipInCidr('2a0a:a440::1', '2a0a:a440::/29')).toBe(true);
    expect(ipInCidr('2a0a:a447:ffff::1', '2a0a:a440::/29')).toBe(true);
  });

  it('rejects an IPv6 address outside the range', () => {
    expect(ipInCidr('2a0a:a448::1', '2a0a:a440::/29')).toBe(false);
  });

  it('normalizes a dual-stack IPv4-mapped address before comparing', () => {
    expect(ipInCidr('::ffff:192.30.252.5', '192.30.252.0/22')).toBe(true);
  });

  it('never matches across families or malformed input', () => {
    expect(ipInCidr('192.30.252.5', '2a0a:a440::/29')).toBe(false);
    expect(ipInCidr('not-an-ip', '192.30.252.0/22')).toBe(false);
    expect(ipInCidr('192.30.252.5', 'not-a-cidr')).toBe(false);
    expect(ipInCidr('192.30.252.5', '192.30.252.0/99')).toBe(false);
  });
});

describe('isGithubHookIp', () => {
  const ranges = ['192.30.252.0/22', '2a0a:a440::/29'];

  it('true when the ip matches one of the ranges', () => {
    expect(isGithubHookIp('192.30.252.10', ranges)).toBe(true);
  });

  it('false when the ip matches none, is missing, or the list is empty', () => {
    expect(isGithubHookIp('8.8.8.8', ranges)).toBe(false);
    expect(isGithubHookIp(undefined, ranges)).toBe(false);
    expect(isGithubHookIp('192.30.252.10', [])).toBe(false);
  });
});
