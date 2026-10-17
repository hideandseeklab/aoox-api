import { DEFAULT_TRUST_PROXY, parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it('defaults to the private-network preset when unset or blank', () => {
    expect(parseTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy('')).toBe(DEFAULT_TRUST_PROXY);
    expect(parseTrustProxy('   ')).toBe(DEFAULT_TRUST_PROXY);
  });

  it('parses booleans and hop counts', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('FALSE')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('2')).toBe(2);
  });

  it('accepts IPs, CIDRs and presets, normalised', () => {
    expect(parseTrustProxy('10.0.0.0/8 , 172.18.0.2,loopback')).toBe(
      '10.0.0.0/8, 172.18.0.2, loopback',
    );
    expect(parseTrustProxy('fd00::/8')).toBe('fd00::/8');
  });

  it('rejects malformed entries', () => {
    expect(() => parseTrustProxy('10.0.0.0/33')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('traefik')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('loopback,,')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('1.2.3.4/8/8')).toThrow(/TRUST_PROXY/);
  });
});
