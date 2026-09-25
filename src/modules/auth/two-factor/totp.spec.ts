import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from './totp';

describe('totp', () => {
  // RFC 4226 appendix D test vectors (secret "12345678901234567890").
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

  it('base32 round-trips and matches the RFC alphabet', () => {
    expect(rfcSecret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(rfcSecret).toString('ascii')).toBe(
      '12345678901234567890',
    );
    expect(base32Decode('gezd gnbv-gy3t')).toEqual(
      base32Decode('GEZDGNBVGY3T'),
    );
  });

  it('produces the RFC 4226 HOTP vectors', () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(rfcSecret, c))).toEqual([
      '755224',
      '287082',
      '359152',
      '969429',
      '520489',
    ]);
  });

  it('TOTP: RFC 6238 vector at t=59 is 94287082 → last 6 digits 287082', () => {
    expect(totp(rfcSecret, 59_000)).toBe('287082');
  });

  it('verifies within ±1 step only and rejects malformed input', () => {
    const at = 1_700_000_000_000;
    const code = totp(rfcSecret, at);
    expect(verifyTotp(rfcSecret, code, 1, at)).toBe(true);
    expect(verifyTotp(rfcSecret, code, 1, at + 30_000)).toBe(true);
    expect(verifyTotp(rfcSecret, code, 1, at + 90_000)).toBe(false);
    expect(verifyTotp(rfcSecret, '12345', 1, at)).toBe(false);
  });

  it('builds a standard otpauth URI', () => {
    expect(otpauthUri('aoox', 'a@b.c', 'ABC')).toBe(
      'otpauth://totp/aoox:a%40b.c?secret=ABC&issuer=aoox&algorithm=SHA1&digits=6&period=30',
    );
  });
});
