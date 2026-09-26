import { renderPanelOverride, upsertEnvVars } from './panel-domain.util';

interface OverrideJson {
  services: {
    web: { labels: Record<string, string> };
    api: { labels: Record<string, string> };
  };
}

function parse(yaml: string): OverrideJson {
  return JSON.parse(yaml) as OverrideJson;
}

describe('renderPanelOverride', () => {
  it('labels web on :3000 and api on :3001 for their own hosts', () => {
    const json = parse(
      renderPanelOverride('panel.example.com', 'api.example.com', {
        httpsPort: 443,
        acme: true,
      }),
    );
    expect(
      json.services.web.labels[
        'traefik.http.services.aoox-web.loadbalancer.server.port'
      ],
    ).toBe('3000');
    expect(
      json.services.api.labels[
        'traefik.http.services.aoox-api.loadbalancer.server.port'
      ],
    ).toBe('3001');
    expect(
      json.services.web.labels['traefik.http.routers.aoox-web-secure.rule'],
    ).toBe('Host(`panel.example.com`)');
    expect(
      json.services.api.labels['traefik.http.routers.aoox-api-secure.rule'],
    ).toBe('Host(`api.example.com`)');
  });

  it('omits the redirect router when there is no ACME resolver', () => {
    const json = parse(
      renderPanelOverride('panel.example.com', 'api.example.com', {
        httpsPort: 443,
        acme: false,
      }),
    );
    expect(
      json.services.web.labels['traefik.http.routers.aoox-web-redirect.rule'],
    ).toBeUndefined();
  });
});

describe('upsertEnvVars', () => {
  it('replaces an existing key in place', () => {
    const out = upsertEnvVars('FOO=old\nBAR=1\n', { FOO: 'new' });
    expect(out).toBe('FOO=new\nBAR=1\n');
  });

  it('appends a missing key', () => {
    const out = upsertEnvVars('BAR=1\n', { FOO: 'new' });
    expect(out).toBe('BAR=1\nFOO=new\n');
  });

  it('sets multiple keys against an empty file', () => {
    const out = upsertEnvVars('', { FOO: 'a', BAR: 'b' });
    expect(out).toBe('FOO=a\nBAR=b\n');
  });

  it('does not touch keys sharing a prefix with the target key', () => {
    const out = upsertEnvVars('WEB_ORIGIN=old\nWEB_ORIGIN_EXTRA=keep\n', {
      WEB_ORIGIN: 'new',
    });
    expect(out).toBe('WEB_ORIGIN=new\nWEB_ORIGIN_EXTRA=keep\n');
  });
});
