import {
  CertificateInputError,
  MAX_PEM_BYTES,
  parseCertificateMaterial,
} from './certificate-material';
import {
  CA_CERT,
  EC_CERT,
  EC_KEY,
  ENCRYPTED_KEY,
  LEAF_CERT,
  LEAF_KEY,
  LEAF_KEY_PKCS1,
  OTHER_KEY,
} from './certificate.fixtures';

const fail = (cert: string, key: string, now?: Date) => {
  try {
    parseCertificateMaterial(cert, key, now);
  } catch (e) {
    expect(e).toBeInstanceOf(CertificateInputError);
    return (e as Error).message;
  }
  throw new Error('expected parseCertificateMaterial to throw');
};

describe('parseCertificateMaterial', () => {
  it('accepts a matching certificate and key and extracts the metadata', () => {
    const m = parseCertificateMaterial(LEAF_CERT, LEAF_KEY);
    expect(m.commonName).toBe('example.test');
    expect(m.domains).toEqual(['example.test', '*.example.test']);
    expect(m.issuer).toBe('aoox test CA');
    expect(m.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(m.notAfter.getTime()).toBeGreaterThan(Date.now());
    expect(m.notBefore.getTime()).toBeLessThanOrEqual(Date.now());
    expect(m.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });

  it('normalizes a PKCS#1 key to PKCS#8', () => {
    const m = parseCertificateMaterial(LEAF_CERT, LEAF_KEY_PKCS1);
    expect(m.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });

  it('keeps the whole bundle, server certificate first', () => {
    const m = parseCertificateMaterial(`${LEAF_CERT}\n${CA_CERT}`, LEAF_KEY);
    const blocks = m.certificatePem.match(/-----BEGIN CERTIFICATE-----/g);
    expect(blocks).toHaveLength(2);
    expect(m.fingerprint).toBe(
      parseCertificateMaterial(LEAF_CERT, LEAF_KEY).fingerprint,
    );
  });

  it('drops text around the PEM blocks', () => {
    const m = parseCertificateMaterial(
      `Bag Attributes\n${LEAF_CERT}\ntrailing junk`,
      `junk\n${LEAF_KEY}\nmore`,
    );
    expect(m.certificatePem.match(/BEGIN CERTIFICATE/g)).toHaveLength(1);
    expect(m.certificatePem).not.toContain('junk');
  });

  it('works with an EC key and falls back to the CN when there are no SANs', () => {
    const m = parseCertificateMaterial(EC_CERT, EC_KEY);
    expect(m.domains).toEqual(['internal.example.test']);
    expect(m.issuer).toBe('internal.example.test');
  });

  it('rejects a key that belongs to another certificate', () => {
    expect(fail(LEAF_CERT, OTHER_KEY)).toMatch(/does not match/);
    expect(fail(LEAF_CERT, EC_KEY)).toMatch(/does not match/);
  });

  it('points at the order when the chain comes before the server certificate', () => {
    expect(fail(`${CA_CERT}\n${LEAF_CERT}`, LEAF_KEY)).toMatch(
      /server certificate must come first/,
    );
  });

  it('rejects an encrypted key with a clear message', () => {
    expect(fail(LEAF_CERT, ENCRYPTED_KEY)).toMatch(/encrypted/);
    expect(
      fail(
        LEAF_CERT,
        '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n-----END RSA PRIVATE KEY-----',
      ),
    ).toMatch(/encrypted/);
  });

  it('rejects an expired certificate', () => {
    const far = new Date('2200-01-01T00:00:00Z');
    expect(fail(LEAF_CERT, LEAF_KEY, far)).toMatch(/expired on 2126-/);
  });

  it('rejects non-PEM and garbage', () => {
    expect(fail('MIIB...', LEAF_KEY)).toMatch(/PEM/);
    expect(fail(LEAF_CERT, 'not a key')).toMatch(/unencrypted PEM/);
    expect(
      fail(
        '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
        LEAF_KEY,
      ),
    ).toMatch(/not a valid X\.509/);
    expect(
      fail(
        LEAF_CERT,
        '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
      ),
    ).toMatch(/could not be read/);
  });

  it('rejects oversized input and absurd chains', () => {
    expect(fail('x'.repeat(MAX_PEM_BYTES + 1), LEAF_KEY)).toMatch(/limited to/);
    expect(fail(LEAF_CERT, 'x'.repeat(MAX_PEM_BYTES + 1))).toMatch(
      /limited to/,
    );
    expect(fail(LEAF_CERT.repeat(11), LEAF_KEY)).toMatch(/at most 10/);
  });
});
