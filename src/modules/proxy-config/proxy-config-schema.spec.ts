import { CERTS_CONFIG_FILE, certFileNames } from '../certificate/certs-config';
import {
  MAX_CONFIG_BYTES,
  userFileName,
  validateDynamicConfig,
} from './proxy-config-schema';

const ok = (content: string) => {
  const r = validateDynamicConfig(content);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.parsed;
};
const errors = (content: string) => {
  const r = validateDynamicConfig(content);
  if (r.ok) throw new Error('expected a rejection');
  return r.errors.join('; ');
};

describe('validateDynamicConfig', () => {
  it('accepts middlewares, routers, services and serversTransports', () => {
    const parsed = ok(`
http:
  middlewares:
    hdrs:
      headers:
        frameDeny: true
    auth-1:
      basicAuth:
        users: ["u:h"]
  routers:
    r1:
      rule: Host(\`a.example.com\`)
      service: s1
  services:
    s1:
      loadBalancer:
        servers:
          - url: http://10.0.0.5:8080
  serversTransports:
    t1:
      insecureSkipVerify: true
`);
    expect(parsed.middlewares).toEqual(['auth-1', 'hdrs']);
    expect(parsed.routers).toEqual(['r1']);
    expect(parsed.services).toEqual(['s1']);
  });

  it('refuses tls, tcp and udp with an explanation', () => {
    expect(
      errors(
        'http:\n  middlewares:\n    a: {headers: {}}\ntls:\n  certificates: []',
      ),
    ).toMatch(/"tls" is not allowed.*certificates/);
    expect(errors('tcp:\n  routers: {}')).toMatch(/"tcp" is not allowed/);
    expect(errors('udp:\n  routers: {}')).toMatch(/"udp" is not allowed/);
  });

  it('refuses unknown keys at both levels', () => {
    expect(errors('entryPoints:\n  web: {}')).toMatch(
      /Unknown top-level key "entryPoints"/,
    );
    expect(errors('http:\n  tls:\n    options: {}')).toMatch(
      /Unknown key "http.tls"/,
    );
  });

  it('refuses bad shapes and names', () => {
    expect(errors('- a\n- b')).toMatch(/mapping/);
    expect(errors('')).toMatch(/mapping/);
    expect(errors('# only a comment')).toMatch(/mapping/);
    expect(errors('http: []')).toMatch(/"http" must be a mapping/);
    expect(errors('http:\n  middlewares: []')).toMatch(
      /must be a mapping of name/,
    );
    expect(
      errors('http:\n  middlewares:\n    Bad_Name:\n      headers: {}'),
    ).toMatch(/Invalid name "Bad_Name"/);
    expect(errors('http:\n  middlewares:\n    a: 3')).toMatch(
      /"http.middlewares.a" must be a mapping/,
    );
    expect(errors('http:\n  middlewares: {}')).toMatch(/declares nothing/);
    expect(errors('other: 1')).toMatch(/Unknown top-level key/);
  });

  it('reports YAML syntax errors with a line, and duplicate keys', () => {
    expect(errors('http:\n  middlewares:\n   a: [unclosed')).toMatch(
      /Invalid YAML.*line/,
    );
    expect(
      errors(
        'http:\n  middlewares:\n    a: {headers: {}}\n    a: {headers: {}}',
      ),
    ).toMatch(/Invalid YAML/);
  });

  it('refuses YAML that tries anything but data (tags are not executed)', () => {
    expect(errors('http: !!js/function "function(){}"')).toMatch(
      /Invalid YAML/,
    );
  });

  it('enforces the size limit in bytes', () => {
    const big = `http:\n  middlewares:\n    a:\n      note: "${'x'.repeat(MAX_CONFIG_BYTES)}"\n`;
    expect(errors(big)).toMatch(/larger than 64 KB/);
  });
});

describe('userFileName', () => {
  it('always starts with user- and ends with .yml', () => {
    expect(userFileName('my-file1')).toBe('user-my-file1.yml');
  });

  it('refuses names that could escape the directory or hit other files', () => {
    for (const bad of [
      '',
      '../x',
      'a/b',
      'a.yml',
      'Cert',
      'certs',
      '-a',
      'a b',
      'x'.repeat(41),
    ]) {
      if (bad === 'certs') {
        // a valid slug on its own: the user- prefix is what keeps it away from certs.yml
        expect(userFileName(bad)).toBe('user-certs.yml');
        continue;
      }
      expect(() => userFileName(bad)).toThrow();
    }
  });
});

describe('coexistence with the certificate module', () => {
  it('no certificate file name can collide with, or be swept as, an operator file', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { cert, key } = certFileNames(id, 'AB:CD:EF:01:00:00:00:00');
    for (const name of [cert, key, CERTS_CONFIG_FILE]) {
      expect(name.startsWith('user-')).toBe(false);
    }
    // the certificate sweep only matches these two patterns
    expect(userFileName('x')).not.toMatch(/\.(crt|key)$/);
    expect(userFileName('x')).not.toBe(CERTS_CONFIG_FILE);
  });
});
