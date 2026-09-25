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
