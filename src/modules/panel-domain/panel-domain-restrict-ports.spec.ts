import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as yaml from 'js-yaml';
import { DockerService } from '../docker/docker.service';
import { ProxyService } from '../proxy/proxy.service';
import { PanelDomainSettings } from './panel-domain-settings.entity';
import { PanelDomainService } from './panel-domain.service';
import {
  assertRestrictPortsAllowed,
  renderPanelOverride,
} from './panel-domain.util';
import { UpdatePanelDomainDto } from './update-panel-domain.dto';

// js-yaml does not know Compose's `!override` tag; accept it as a plain sequence.
const OverrideTag = new yaml.Type('!override', {
  kind: 'sequence',
  construct: (data: unknown) => ({ override: data }),
});
const SCHEMA = yaml.DEFAULT_SCHEMA.extend([OverrideTag]);

interface Parsed {
  services: Record<
    'web' | 'api',
    { labels: Record<string, string>; ports?: { override: string[] } }
  >;
}

describe('renderPanelOverride restrictPorts', () => {
  const opts = { httpsPort: 443, acme: true };

  it('is unchanged JSON without the option (no ports key)', () => {
    const out = renderPanelOverride('p.example.com', 'a.example.com', opts);
    const json = JSON.parse(out) as Parsed;
    expect(json.services.web.ports).toBeUndefined();
    expect(out).toBe(
      renderPanelOverride('p.example.com', 'a.example.com', {
        ...opts,
        restrictPorts: false,
      }),
    );
  });

  it('adds loopback-only !override ports and keeps the labels', () => {
    const out = renderPanelOverride('p.example.com', 'a.example.com', {
      ...opts,
      restrictPorts: true,
    });
    expect(out).toContain('ports: !override [');
    const parsed = yaml.load(out, { schema: SCHEMA }) as Parsed;
    expect(parsed.services.web.ports?.override).toEqual([
      '127.0.0.1:${WEB_PORT:-3000}:3000',
    ]);
    expect(parsed.services.api.ports?.override).toEqual([
      '127.0.0.1:${API_PORT:-3001}:3001',
    ]);
    const plain = JSON.parse(
      renderPanelOverride('p.example.com', 'a.example.com', opts),
    ) as Parsed;
    expect(parsed.services.web.labels).toEqual(plain.services.web.labels);
    expect(parsed.services.api.labels).toEqual(plain.services.api.labels);
  });
});

describe('assertRestrictPortsAllowed', () => {
  it('requires both hosts when on', () => {
    expect(() =>
      assertRestrictPortsAllowed(null, 'a.example.com', true),
    ).toThrow(BadRequestException);
    expect(() => assertRestrictPortsAllowed('p.example.com', '', true)).toThrow(
      BadRequestException,
    );
    expect(() => assertRestrictPortsAllowed(null, null, true)).toThrow(
      BadRequestException,
    );
  });

  it('allows it with both hosts, and off without them', () => {
    expect(() =>
      assertRestrictPortsAllowed('p.example.com', 'a.example.com', true),
    ).not.toThrow();
    expect(() => assertRestrictPortsAllowed(null, null, false)).not.toThrow();
  });
});

describe('PanelDomainService restrictPorts', () => {
  function build(stored: Partial<PanelDomainSettings> = {}) {
    let row: PanelDomainSettings | null = stored.id
      ? ({ ...stored } as PanelDomainSettings)
      : null;
    const repo = {
      findOne: jest.fn(() => Promise.resolve(row)),
      create: jest.fn((v: Partial<PanelDomainSettings>) => v),
      merge: jest.fn((a: object, b: object) => ({ ...a, ...b })),
      save: jest.fn((v: PanelDomainSettings) => {
        row = v;
        return Promise.resolve(v);
      }),
    };
    const config = {
      get: jest.fn((k: string) =>
        k === 'INSTALL_DIR' ? '/opt/aoox' : undefined,
      ),
    };
    const proxy = { status: jest.fn(() => Promise.resolve({ running: true })) };
    const service = new PanelDomainService(
      repo as never,
      {} as DockerService,
      config as unknown as ConfigService,
      proxy as unknown as ProxyService,
    );
    // The detached apply() must not touch Docker in this test.
    jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
    return { service, repo };
  }
  const dto = (extra: Partial<UpdatePanelDomainDto> = {}) => ({
    webHost: 'p.example.com',
    apiHost: 'a.example.com',
    ...extra,
  });

  afterEach(() => jest.restoreAllMocks());

  it('defaults to off and reports no recovery note', async () => {
    const { service } = build();
    const r = await service.update(dto());
    expect(r.settings.restrictPorts).toBe(false);
    expect(r.restrictPortsNote).toBeNull();
  });

  it('stores it when asked and returns the recovery note', async () => {
    const { service } = build();
    const r = await service.update(dto({ restrictPorts: true }));
    expect(r.settings.restrictPorts).toBe(true);
    expect(r.restrictPortsNote).toContain('docker-compose.override.yml');
  });

  it('keeps the stored value when omitted, and false turns it off', async () => {
    const { service } = build({
      id: 'default',
      webHost: 'p.example.com',
      apiHost: 'a.example.com',
      restrictPorts: true,
    });
    expect((await service.update(dto())).settings.restrictPorts).toBe(true);
    expect(
      (await service.update(dto({ restrictPorts: false }))).settings
        .restrictPorts,
    ).toBe(false);
  });
});
