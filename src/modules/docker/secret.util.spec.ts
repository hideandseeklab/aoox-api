import { decryptSecret, encryptSecret } from './secret.util';

describe('registry secret encryption', () => {
  it('round-trips a password', () => {
    const enc = encryptSecret('s3cret-p@ss', 'key-a');
    expect(enc).not.toContain('s3cret');
    expect(decryptSecret(enc, 'key-a')).toBe('s3cret-p@ss');
  });

  it('uses a fresh iv per call', () => {
    expect(encryptSecret('same', 'key-a')).not.toBe(
      encryptSecret('same', 'key-a'),
    );
  });

  it('rejects a different key or tampered payload', () => {
    const enc = encryptSecret('secret', 'key-a');
    expect(() => decryptSecret(enc, 'key-b')).toThrow();
    const tampered = Buffer.from(enc, 'base64');
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptSecret(tampered.toString('base64'), 'key-a')).toThrow();
  });
});
