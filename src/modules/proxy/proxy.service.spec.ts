import { ProxyService } from './proxy.service';

const acme = { httpsPort: 443, acme: true };
const noAcme = { httpsPort: 443, acme: false };

describe('ProxyService.buildLabels', () => {
  it('returns no labels without domains (container stays hidden from Traefik)', () => {
    expect(ProxyService.buildLabels('app', 3000, [], acme)).toEqual({});
  });

  it('without ACME routes every host on web and https hosts on websecure, no redirect', () => {
    const labels = ProxyService.buildLabels(
      'my-app',
      8080,
      [
        { host: 'a.example.com', https: false },
        { host: 'b.example.com', https: true },
      ],
      noAcme,
    );
    expect(labels).toEqual({
      'traefik.enable': 'true',
      'traefik.http.services.my-app.loadbalancer.server.port': '8080',
      'traefik.http.routers.my-app.rule':
        'Host(`a.example.com`) || Host(`b.example.com`)',
      'traefik.http.routers.my-app.entrypoints': 'web',
      'traefik.http.routers.my-app.service': 'my-app',
      'traefik.http.routers.my-app-secure.rule': 'Host(`b.example.com`)',
      'traefik.http.routers.my-app-secure.entrypoints': 'websecure',
      'traefik.http.routers.my-app-secure.service': 'my-app',
      'traefik.http.routers.my-app-secure.tls': 'true',
      'traefik.http.routers.my-app-secure.tls.certresolver': 'le',
    });
  });

  it('with ACME redirects https hosts to https and keeps plain hosts on http', () => {
    const labels = ProxyService.buildLabels(
      'my-app',
      8080,
      [
        { host: 'a.example.com', https: false },
        { host: 'b.example.com', https: true },
      ],
      acme,
    );
    expect(labels).toMatchObject({
      'traefik.http.routers.my-app.rule': 'Host(`a.example.com`)',
      'traefik.http.routers.my-app.entrypoints': 'web',
      'traefik.http.routers.my-app-redirect.rule': 'Host(`b.example.com`)',
      'traefik.http.routers.my-app-redirect.entrypoints': 'web',
      'traefik.http.routers.my-app-redirect.service': 'my-app',
      'traefik.http.routers.my-app-redirect.middlewares': 'my-app-https@docker',
      'traefik.http.middlewares.my-app-https.redirectscheme.scheme': 'https',
      'traefik.http.middlewares.my-app-https.redirectscheme.permanent': 'true',
      'traefik.http.routers.my-app-secure.entrypoints': 'websecure',
    });
    expect(
      labels['traefik.http.middlewares.my-app-https.redirectscheme.port'],
    ).toBe('443');
  });

  it('drops the plain web router when every host is https, and sets the port for non-443', () => {
    const labels = ProxyService.buildLabels(
      'x',
      80,
      [{ host: 'h', https: true }],
      { httpsPort: 8443, acme: true },
    );
    expect(labels).not.toHaveProperty('traefik.http.routers.x.rule');
    expect(labels['traefik.http.routers.x-redirect.rule']).toBe('Host(`h`)');
    expect(labels['traefik.http.middlewares.x-https.redirectscheme.port']).toBe(
      '8443',
    );
  });

  it('omits secure and redirect routers when no host is https', () => {
    const labels = ProxyService.buildLabels(
      'x',
      80,
      [{ host: 'h', https: false }],
      acme,
    );
    const keys = Object.keys(labels);
    expect(keys.some((k) => k.includes('-secure'))).toBe(false);
    expect(keys.some((k) => k.includes('-redirect'))).toBe(false);
  });
});

describe('ProxyService.buildLabels with operator middlewares', () => {
  const router = (labels: Record<string, string>, name: string) => ({
    rule: labels[`traefik.http.routers.${name}.rule`],
    middlewares: labels[`traefik.http.routers.${name}.middlewares`],
  });

  it('domains without middlewares produce exactly the same labels as before', () => {
    const domains = [
      { host: 'a.example.com', https: true },
      { host: 'b.example.com', https: true, customCert: true },
      { host: 'c.example.com', https: false },
    ];
    const withEmpty = domains.map((d) => ({ ...d, middlewares: [] }));
    expect(ProxyService.buildLabels('app', 80, withEmpty, acme)).toEqual(
      ProxyService.buildLabels('app', 80, domains, acme),
    );
  });

  it('puts middlewares on the https router and splits hosts by middleware list', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [
        { host: 'plain.example.com', https: true },
        { host: 'a.example.com', https: true, middlewares: ['auth@file'] },
        { host: 'b.example.com', https: true, middlewares: ['auth@file'] },
        {
          host: 'c.example.com',
          https: true,
          middlewares: ['hdrs@file', 'auth@file'],
        },
      ],
      acme,
    );
    // hosts without middlewares keep the original router, untouched
    expect(router(labels, 'app-secure')).toEqual({
      rule: 'Host(`plain.example.com`)',
      middlewares: undefined,
    });
    const secure = Object.keys(labels)
      .filter((k) => /routers\.app-secure-m[0-9a-f]{8}\.rule$/.test(k))
      .map((k) => ({
        rule: labels[k],
        mw: labels[k.replace('.rule', '.middlewares')],
      }))
      .sort((x, y) => x.rule.localeCompare(y.rule));
    expect(secure).toEqual([
      {
        rule: 'Host(`a.example.com`) || Host(`b.example.com`)',
        mw: 'auth@file',
      },
      { rule: 'Host(`c.example.com`)', mw: 'hdrs@file,auth@file' },
    ]);
  });

  it('the group router name depends only on its own list, not on the other domains', () => {
    const one = ProxyService.buildLabels(
      'app',
      80,
      [{ host: 'a.example.com', https: true, middlewares: ['auth@file'] }],
      acme,
    );
    const two = ProxyService.buildLabels(
      'app',
      80,
      [
        { host: 'z.example.com', https: true },
        { host: 'a.example.com', https: true, middlewares: ['auth@file'] },
      ],
      acme,
    );
    const names = (l: Record<string, string>) =>
      Object.keys(l).filter((k) => /-m[0-9a-f]{8}\.rule$/.test(k));
    expect(names(one)).toEqual(names(two));
  });

  it('applies to custom-certificate routers and to plain-http hosts, never to the redirect router', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [
        {
          host: 'c.example.com',
          https: true,
          customCert: true,
          middlewares: ['hdrs@file'],
        },
        { host: 'h.example.com', https: false, middlewares: ['rl@file'] },
      ],
      acme,
    );
    const keys = Object.keys(labels);
    const customKey = keys.find((k) =>
      /secure-custom-m[0-9a-f]{8}\.middlewares$/.test(k),
    );
    expect(labels[customKey!]).toBe('hdrs@file');
    const plainKey = keys.find((k) =>
      /routers\.app-m[0-9a-f]{8}\.middlewares$/.test(k),
    );
    expect(labels[plainKey!]).toBe('rl@file');
    // the redirect router keeps only its own redirect middleware
    expect(labels['traefik.http.routers.app-redirect.middlewares']).toBe(
      'app-https@docker',
    );
  });

  it('without ACME an https host is served on both routers, and both carry the middlewares', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [{ host: 'a.example.com', https: true, middlewares: ['auth@file'] }],
      noAcme,
    );
    const withMw = Object.keys(labels).filter((k) =>
      k.endsWith('.middlewares'),
    );
    expect(withMw).toHaveLength(2);
    for (const k of withMw) expect(labels[k]).toBe('auth@file');
  });

  it('drops anything that is not a name@file reference (no label injection) and repeats', () => {
    const labels = ProxyService.buildLabels(
      'app',
      80,
      [
        {
          host: 'a.example.com',
          https: true,
          middlewares: [
            'ok@file',
            'ok@file',
            'x@docker',
            'bad name@file',
            'a@file,b@file',
            '../x@file',
          ],
        },
      ],
      acme,
    );
    const mw = Object.entries(labels).filter(
      ([k]) => k.endsWith('.middlewares') && !k.includes('redirect'),
    );
    expect(mw.map(([, v]) => v)).toEqual(['ok@file']);
  });
});
