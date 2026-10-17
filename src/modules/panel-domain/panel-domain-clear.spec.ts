import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DockerService } from '../docker/docker.service';
import { ProxyService } from '../proxy/proxy.service';
import { PanelDomainSettings } from './panel-domain-settings.entity';
import { PanelDomainService } from './panel-domain.service';
import {
  renderClearDomainScript,
  toDaemonUnreachable,
} from './panel-domain.util';

describe('renderClearDomainScript', () => {
  const script = renderClearDomainScript('/opt/aoox');

  it('runs compose without the override and deletes it first', () => {
    const lines = script.split('\n');
    const rm = lines.indexOf('rm -f docker-compose.override.yml');
    const up = lines.findIndex((l) => l.startsWith('docker compose'));
    expect(rm).toBeGreaterThan(-1);
    expect(up).toBeGreaterThan(rm);
    expect(lines[up]).toBe(
      'docker compose -f docker-compose.dist.yml --env-file .env.dist up -d',
    );
    expect(lines[up]).not.toContain('override');
  });

  it('keeps PROXY_ACME_EMAIL and blanks the domain keys', () => {
    expect(script).not.toContain('PROXY_ACME_EMAIL');
    for (const k of ['WEB_DOMAIN', 'API_DOMAIN', 'COOKIE_SECURE']) {
      expect(script).toContain(`s|^${k}=.*|${k}=|`);
    }
    expect(script).toContain('WEB_ORIGIN=http://$IP:$WP');
    expect(script).toContain('PUBLIC_API_URL=http://$IP:$AP');
  });

  // The script is plain POSIX sh: run the env part for real (skip on Windows
  // hosts without sh).
  const hasSh = (() => {
    try {
      execFileSync('sh', ['-c', 'true']);
      return true;
    } catch {
      return false;
    }
  })();
  (hasSh ? it : it.skip)('rewrites .env.dist like a no-domain install', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aoox-clear-'));
    writeFileSync(
      join(dir, '.env.dist'),
      [
        'PUBLIC_IP=203.0.113.9',
        'WEB_PORT=3100',
        'WEB_DOMAIN=p.example.com',
        'API_DOMAIN=a.example.com',
        'PROXY_ACME_EMAIL=me@example.com',
        'WEB_ORIGIN=https://p.example.com',
        'PUBLIC_API_URL=https://a.example.com',
        'COOKIE_SECURE=true',
        '',
      ].join('\n'),
    );
    const envPart = script
      .split('\n')
      .filter((l) => !l.startsWith('rm ') && !l.startsWith('docker compose'))
      .join('\n')
      .replace(
        'cd /opt/aoox',
        `cd '${dir.split(String.fromCharCode(92)).join('/')}'`,
      );
    execFileSync('sh', ['-c', envPart]);
    const out = readFileSync(join(dir, '.env.dist'), 'utf8');
    expect(out).toContain('WEB_DOMAIN=\n');
    expect(out).toContain('API_DOMAIN=\n');
    expect(out).toContain('COOKIE_SECURE=\n');
    expect(out).toContain('PROXY_ACME_EMAIL=me@example.com\n');
    expect(out).toContain('WEB_ORIGIN=http://203.0.113.9:3100\n');
    expect(out).toContain('PUBLIC_API_URL=http://203.0.113.9:3001\n');
  });
});

describe('toDaemonUnreachable', () => {
  it('turns a socket error into a 502 with a hint', () => {
    const e = toDaemonUnreachable(
      new Error('connect ENOENT /var/run/docker.sock'),
    );
    expect(e).toBeInstanceOf(BadGatewayException);
    expect(e.message).toContain('The Docker daemon is not reachable');
    expect(e.message).toContain('ENOENT');
  });

  it('passes HTTP errors through', () => {
    const bad = new BadRequestException('x');
    expect(toDaemonUnreachable(bad)).toBe(bad);
  });
});

describe('PanelDomainService daemon down / clear', () => {
  function build(
    stored: Partial<PanelDomainSettings>,
    installDir = '/opt/aoox',
  ) {
    let row = stored.id ? ({ ...stored } as PanelDomainSettings) : null;
    const repo = {
      findOne: jest.fn(() => Promise.resolve(row)),
      create: jest.fn((v: Partial<PanelDomainSettings>) => v),
      merge: jest.fn((a: object, b: object) => ({ ...a, ...b })),
      save: jest.fn((v: PanelDomainSettings) => {
        row = v;
        return Promise.resolve(v);
      }),
    };
    const docker = {
      engine: { ping: jest.fn(() => Promise.resolve('OK')) },
    };
    const config = {
      get: jest.fn(
        (k: string) =>
          ({ INSTALL_DIR: installDir, PUBLIC_IP: '203.0.113.9' })[k],
      ),
    };
    const proxy = {
      status: jest.fn(() => Promise.resolve({ running: true })),
    };
    const service = new PanelDomainService(
      repo as never,
      docker as unknown as DockerService,
      config as unknown as ConfigService,
      proxy as unknown as ProxyService,
    );
    jest.spyOn(global, 'setTimeout').mockImplementation((() => 0) as never);
    return { service, repo, docker, proxy };
  }
  const dto = { webHost: 'p.example.com', apiHost: 'a.example.com' };
  const stored = {
    id: 'default',
    webHost: 'p.example.com',
    apiHost: 'a.example.com',
    acmeEmail: 'me@example.com',
    restrictPorts: true,
  };

  afterEach(() => jest.restoreAllMocks());

  it('update answers 502 and saves nothing when the daemon is down', async () => {
    const { service, repo, proxy } = build({});
    proxy.status.mockRejectedValue(new Error('connect ENOENT docker.sock'));
    await expect(service.update(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('clear answers 502 and saves nothing when the daemon is down', async () => {
    const { service, repo, docker } = build(stored);
    docker.engine.ping.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(service.clear()).rejects.toBeInstanceOf(BadGatewayException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('clear needs INSTALL_DIR', async () => {
    const { service } = build(stored, '');
    await expect(service.clear()).rejects.toThrow(/INSTALL_DIR is not set/);
  });

  it('clear refuses when there is no domain', async () => {
    const { service } = build({});
    await expect(service.clear()).rejects.toThrow('No panel domain is set');
  });

  it('clear drops the hosts and restrictPorts, keeps the ACME email', async () => {
    const { service } = build(stored);
    const r = await service.clear();
    expect(r.settings.webHost).toBeNull();
    expect(r.settings.apiHost).toBeNull();
    expect(r.settings.restrictPorts).toBe(false);
    expect(r.settings.acmeEmail).toBe('me@example.com');
    expect(r.reopenUrl).toBe('http://203.0.113.9:3000');
  });
});
