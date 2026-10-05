/** Named volume holding the custom certificates, mounted into the proxy. */
export const PROXY_CERTS_VOLUME = 'aoox_proxy_certs';
/** Where Traefik's file provider reads it (`--providers.file.directory`). */
export const PROXY_CERTS_DIR = '/etc/traefik/dynamic';
/** The dynamic-configuration file listing every certificate. */
export const CERTS_CONFIG_FILE = 'certs.yml';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First 8 hex digits of an openssl-style fingerprint (`AB:CD:...`), lowercase. */
function fingerprintTag(fingerprint: string): string {
  const tag = fingerprint.replace(/:/g, '').slice(0, 8).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(tag)) {
    throw new Error(`Invalid certificate fingerprint "${fingerprint}"`);
  }
  return tag;
}

/**
 * File names are `<id>-<8 hex of the fingerprint>`: derived from the row id
 * and the certificate's own digest only, never from user input. Replacing a
 * certificate changes its fingerprint and so its file names: the new pair is
 * written next to the old one and certs.yml (written last) switches over, so
 * Traefik can never pair a new certificate with the old key (it watches the
 * directory and reloads on every write).
 */
export function certFileNames(
  id: string,
  fingerprint: string,
): { cert: string; key: string } {
  if (!UUID.test(id)) throw new Error(`Invalid certificate id "${id}"`);
  const base = `${id}-${fingerprintTag(fingerprint)}`;
  return { cert: `${base}.crt`, key: `${base}.key` };
}

export interface CertEntry {
  id: string;
  fingerprint: string;
}

/**
 * Traefik dynamic configuration (file provider) for a set of certificates.
 * Pure. JSON would be valid YAML too, but a plain document is easier to read
 * when someone inspects the volume.
 */
export function renderCertsYml(entries: readonly CertEntry[]): string {
  if (entries.length === 0) {
    return '# aoox: no custom certificates\ntls:\n  certificates: []\n';
  }
  const lines = ['# aoox: generated, do not edit', 'tls:', '  certificates:'];
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sorted) {
    const f = certFileNames(e.id, e.fingerprint);
    lines.push(
      `    - certFile: ${PROXY_CERTS_DIR}/${f.cert}`,
      `      keyFile: ${PROXY_CERTS_DIR}/${f.key}`,
    );
  }
  return lines.join('\n') + '\n';
}
