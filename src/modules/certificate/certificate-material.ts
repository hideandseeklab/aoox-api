import { createPrivateKey, KeyObject, X509Certificate } from 'node:crypto';

/** Per field. A chain of a few certificates is a few KB; this is generous. */
export const MAX_PEM_BYTES = 64 * 1024;
const MAX_CHAIN = 10;

/** The uploaded material is unusable; the message is shown to the user. */
export class CertificateInputError extends Error {}

export interface CertificateMaterial {
  /** Normalized bundle: server certificate first, then the chain. */
  certificatePem: string;
  /** PKCS#8, unencrypted (what the proxy volume receives). */
  privateKeyPem: string;
  commonName: string | null;
  /** DNS names covered: SANs, or the CN only when there are no DNS SANs. */
  domains: string[];
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  fingerprint: string;
}

const CERT_BLOCK =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const KEY_BLOCK =
  /-----BEGIN ((?:RSA |EC |DSA )?PRIVATE KEY)-----[\s\S]+?-----END \1-----/;
const HOSTNAME = /^(\*\.)?(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))*$/i;

function field(subject: string, key: string): string | null {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(subject);
  return m ? m[1].trim() || null : null;
}

/** DNS entries of `subjectAltName` ("DNS:a.com, DNS:*.a.com, IP Address:1.2.3.4"). */
function dnsNames(san: string | undefined): string[] {
  if (!san) return [];
  const out: string[] = [];
  for (const part of san.split(/,\s*(?=[A-Za-z ]+:)/)) {
    const m = /^DNS:(.*)$/.exec(part.trim());
    if (!m) continue;
    const name = m[1]
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .toLowerCase();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Validates an uploaded certificate bundle + private key and extracts what the
 * panel stores and shows. Pure (the clock is a parameter), unit-tested.
 * Rejects: oversize input, non-PEM, an unparsable chain, an encrypted key, a
 * key that does not belong to the first certificate, an expired certificate.
 */
export function parseCertificateMaterial(
  certificate: string,
  privateKey: string,
  now: Date = new Date(),
): CertificateMaterial {
  if (
    Buffer.byteLength(certificate, 'utf8') > MAX_PEM_BYTES ||
    Buffer.byteLength(privateKey, 'utf8') > MAX_PEM_BYTES
  ) {
    throw new CertificateInputError(
      `Certificate and key are limited to ${MAX_PEM_BYTES / 1024} KB each`,
    );
  }

  const blocks: string[] = certificate.match(CERT_BLOCK) ?? [];
  if (blocks.length === 0) {
    throw new CertificateInputError(
      'The certificate must be PEM text ("-----BEGIN CERTIFICATE-----"); convert DER/PFX files with openssl first',
    );
  }
  if (blocks.length > MAX_CHAIN) {
    throw new CertificateInputError(
      `The certificate bundle has ${blocks.length} certificates; at most ${MAX_CHAIN} are accepted`,
    );
  }
  const chain = blocks.map((b, i) => {
    try {
      return new X509Certificate(b);
    } catch {
      throw new CertificateInputError(
        `Certificate #${i + 1} in the bundle is not a valid X.509 certificate`,
      );
    }
  });
  const leaf = chain[0];

  if (
    /-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(privateKey) ||
    /Proc-Type:\s*4,ENCRYPTED/i.test(privateKey)
  ) {
    throw new CertificateInputError(
      'The private key is encrypted with a passphrase; remove it first (openssl rsa -in key.pem -out key-unencrypted.pem)',
    );
  }
  const keyBlock = KEY_BLOCK.exec(privateKey);
  if (!keyBlock) {
    throw new CertificateInputError(
      'The private key must be unencrypted PEM text ("-----BEGIN PRIVATE KEY-----")',
    );
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: keyBlock[0], format: 'pem' });
  } catch {
    throw new CertificateInputError('The private key could not be read');
  }
  if (!leaf.checkPrivateKey(key)) {
    throw new CertificateInputError(
      'The private key does not match the first certificate of the bundle (the server certificate must come first, then the chain)',
    );
  }

  const notBefore = new Date(leaf.validFrom);
  const notAfter = new Date(leaf.validTo);
  if (notAfter.getTime() <= now.getTime()) {
    throw new CertificateInputError(
      `The certificate expired on ${notAfter.toISOString().slice(0, 10)}`,
    );
  }

  const commonName = field(leaf.subject, 'CN');
  let domains = dnsNames(leaf.subjectAltName);
  if (domains.length === 0 && commonName && HOSTNAME.test(commonName)) {
    domains = [commonName.toLowerCase()];
  }
  if (domains.length === 0) {
    throw new CertificateInputError(
      'The certificate has no DNS names (subject alternative names) to serve',
    );
  }

  return {
    certificatePem: chain.map((c) => c.toString().trim()).join('\n') + '\n',
    privateKeyPem: key.export({ type: 'pkcs8', format: 'pem' }) as string,
    commonName,
    domains,
    issuer:
      field(leaf.issuer, 'CN') ??
      field(leaf.issuer, 'O') ??
      leaf.issuer.replace(/\n/g, ', '),
    notBefore,
    notAfter,
    fingerprint: leaf.fingerprint256,
  };
}
