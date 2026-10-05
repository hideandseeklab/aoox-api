import { certFileNames, renderCertsYml } from './certs-config';

const A = '11111111-1111-4111-8111-111111111111';
const B = '00000000-0000-4000-8000-000000000002';
const FP_A = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const FP_B = '0F:1E:2D:3C:4B:5A:69:78:0F:1E:2D:3C:4B:5A:69:78';

describe('certs-config', () => {
  it('renders one entry per certificate, sorted, pointing into the proxy directory', () => {
    expect(
      renderCertsYml([
        { id: A, fingerprint: FP_A },
        { id: B, fingerprint: FP_B },
      ]),
    ).toBe(
      [
        '# aoox: generated, do not edit',
        'tls:',
        '  certificates:',
        `    - certFile: /etc/traefik/dynamic/${B}-0f1e2d3c.crt`,
        `      keyFile: /etc/traefik/dynamic/${B}-0f1e2d3c.key`,
        `    - certFile: /etc/traefik/dynamic/${A}-abcdef01.crt`,
        `      keyFile: /etc/traefik/dynamic/${A}-abcdef01.key`,
        '',
      ].join(String.fromCharCode(10)),
    );
  });

  it('renders a valid empty document when nothing is assigned', () => {
    expect(renderCertsYml([])).toContain('certificates: []');
  });

  it('names files after the id and the first 8 hex digits of the fingerprint, so new content gets new names', () => {
    expect(certFileNames(A, FP_A)).toEqual({
      cert: `${A}-abcdef01.crt`,
      key: `${A}-abcdef01.key`,
    });
    expect(certFileNames(A, FP_B).cert).not.toBe(certFileNames(A, FP_A).cert);
    // The same content keeps the same names (an idempotent sync rewrites in place).
    expect(certFileNames(A, FP_A)).toEqual(certFileNames(A, FP_A));
  });

  it('only derives file names from a uuid and hex digits', () => {
    expect(() => certFileNames('../../etc/passwd', FP_A)).toThrow();
    expect(() => certFileNames(`${A}; rm -rf /`, FP_A)).toThrow();
    expect(() => certFileNames(A, '../../x')).toThrow();
    expect(() => certFileNames(A, 'ZZ:ZZ:ZZ:ZZ')).toThrow();
    expect(() => certFileNames(A, '')).toThrow();
    expect(() => renderCertsYml([{ id: 'x', fingerprint: FP_A }])).toThrow();
  });
});
