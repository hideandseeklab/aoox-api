import {
  appDynamicConfig,
  MAINTENANCE_PRIORITY,
  sharedDynamicConfig,
  toDynamicYaml,
} from './maintenance-dynamic';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  escapeHtml,
  MAINTENANCE_MESSAGE_MAX,
  normalizeMaintenanceMessage,
  renderMaintenanceNginxConf,
  renderMaintenancePage,
} from './maintenance-page';

const APP = '0b7c1f2e-1111-4222-8333-944455556666';
const HDR = `aoox-maint-${APP}-hdr@file`;

type Routers = Record<string, Record<string, unknown>>;
function routersOf(config: object | null): Routers {
  return (config as { http: { routers: Routers } }).http.routers;
}

describe('maintenance page text', () => {
  it('escapes markup so the message is always text', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
    const page = renderMaintenancePage('<img src=x onerror=alert(1)>');
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(page).not.toContain('<img');
  });

  it('shows the default message when none is set', () => {
    expect(renderMaintenancePage(null)).toContain(
      escapeHtml(DEFAULT_MAINTENANCE_MESSAGE),
    );
  });

  it('normalizes the message: trims, drops control characters, keeps newlines, limits length', () => {
    expect(normalizeMaintenanceMessage('   ')).toBeNull();
    expect(normalizeMaintenanceMessage(null)).toBeNull();
    expect(normalizeMaintenanceMessage('  hi\u0000there\r\nnext  ')).toBe(
      'hithere\nnext',
    );
    const long = normalizeMaintenanceMessage('a'.repeat(1000));
    expect(long).toHaveLength(MAINTENANCE_MESSAGE_MAX);
  });

  it('nginx answers 503 with Retry-After and picks the page by the app header', () => {
    const conf = renderMaintenanceNginxConf();
    expect(conf).toContain('return 503;');
    expect(conf).toContain('error_page 503 /__maintenance;');
    expect(conf).toContain('add_header Retry-After 300 always;');
    expect(conf).toContain(
      'try_files /pages/$http_x_aoox_app.html /pages/default.html =503;',
    );
  });
});

describe('maintenance Traefik routing', () => {
  it('shared file defines the one service that answers 503', () => {
    expect(sharedDynamicConfig()).toEqual({
      http: {
        services: {
          'aoox-maintenance': {
            loadBalancer: { servers: [{ url: 'http://aoox-maintenance:80' }] },
          },
        },
      },
    });
  });

  it('returns null without domains', () => {
    expect(appDynamicConfig(APP, [], { acme: true })).toBeNull();
  });

  it('plain hosts get a web router that outranks the app routers', () => {
    const routers = routersOf(
      appDynamicConfig(
        APP,
        [
          {
            host: 'a.example.com',
            https: false,
            customCert: false,
            middlewares: [],
          },
        ],
        { acme: true },
      ),
    );
    const r = routers[`aoox-maint-${APP}-web`];
    expect(r).toMatchObject({
      rule: 'Host(`a.example.com`)',
      entryPoints: ['web'],
      service: 'aoox-maintenance@file',
      middlewares: [HDR],
      priority: MAINTENANCE_PRIORITY,
    });
    expect(r).not.toHaveProperty('tls');
  });

  it('https hosts with ACME are on websecure with the resolver and get no web router (the docker redirect still applies)', () => {
    const routers = routersOf(
      appDynamicConfig(
        APP,
        [
          {
            host: 'b.example.com',
            https: true,
            customCert: false,
            middlewares: [],
          },
        ],
        { acme: true },
      ),
    );
    expect(routers[`aoox-maint-${APP}-web`]).toBeUndefined();
    expect(routers[`aoox-maint-${APP}-secure`]).toMatchObject({
      rule: 'Host(`b.example.com`)',
      entryPoints: ['websecure'],
      tls: { certResolver: 'le' },
    });
  });

  it('https hosts without ACME fall back to the plain web router, like the labels do', () => {
    const routers = routersOf(
      appDynamicConfig(
        APP,
        [
          {
            host: 'c.example.com',
            https: true,
            customCert: false,
            middlewares: [],
          },
        ],
        { acme: false },
      ),
    );
    expect(routers[`aoox-maint-${APP}-web`]).toBeDefined();
    expect(routers[`aoox-maint-${APP}-secure`]).toBeUndefined();
  });

  it('custom certificate hosts use websecure with tls and no resolver', () => {
    const routers = routersOf(
      appDynamicConfig(
        APP,
        [
          {
            host: 'd.example.com',
            https: true,
            customCert: true,
            middlewares: [],
          },
        ],
        { acme: true },
      ),
    );
    expect(routers[`aoox-maint-${APP}-secure-custom`]).toMatchObject({
      rule: 'Host(`d.example.com`)',
      entryPoints: ['websecure'],
      tls: {},
    });
    expect(routers[`aoox-maint-${APP}-secure`]).toBeUndefined();
    expect(routers[`aoox-maint-${APP}-web`]).toBeUndefined();
  });

  it('operator middlewares stay in front of the page, grouped per list, header middleware last', () => {
    const config = appDynamicConfig(
      APP,
      [
        {
          host: 'e.example.com',
          https: false,
          customCert: false,
          middlewares: ['auth@file'],
        },
        {
          host: 'f.example.com',
          https: false,
          customCert: false,
          middlewares: ['auth@file'],
        },
        {
          host: 'g.example.com',
          https: false,
          customCert: false,
          middlewares: [],
        },
        {
          host: 'h.example.com',
          https: false,
          customCert: false,
          middlewares: ['bad;x'],
        },
      ],
      { acme: false },
    ) as { http: { routers: Routers; middlewares: Record<string, unknown> } };
    const grouped = Object.values(config.http.routers).filter(
      (r) => (r.middlewares as string[])[0] === 'auth@file',
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0].rule).toBe(
      'Host(`e.example.com`) || Host(`f.example.com`)',
    );
    expect(grouped[0].middlewares).toEqual(['auth@file', HDR]);
    // Invalid middleware refs are dropped before they reach a label/file value.
    expect(JSON.stringify(config)).not.toContain('bad;x');
    expect(config.http.middlewares[`aoox-maint-${APP}-hdr`]).toEqual({
      headers: { customRequestHeaders: { 'X-Aoox-App': APP } },
    });
  });

  it('skips hosts that do not look like hostnames and renders as YAML-compatible JSON', () => {
    const config = appDynamicConfig(
      APP,
      [{ host: 'bad`host', https: false, customCert: false, middlewares: [] }],
      { acme: false },
    );
    expect(config).toBeNull();
    expect(toDynamicYaml({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});
