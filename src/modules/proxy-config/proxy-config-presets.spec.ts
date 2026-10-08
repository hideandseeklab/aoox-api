import { BadRequestException } from '@nestjs/common';
import { compare } from 'bcryptjs';
import { load } from 'js-yaml';
import { redactBody } from '../audit-log/redact';
import {
  buildPreset,
  htpasswdBcrypt,
  isIpOrCidr,
  PRESETS,
} from './proxy-config-presets';
import { validateDynamicConfig } from './proxy-config-schema';

const mw = (content: string, name: string): Record<string, unknown> => {
  const doc = load(content) as {
    http: { middlewares: Record<string, Record<string, unknown>> };
  };
  return doc.http.middlewares[name];
};

describe('proxy config presets', () => {
  it('every preset produces YAML the schema accepts', async () => {
    const samples: Record<string, Record<string, unknown>> = {
      'basic-auth': { username: 'admin', password: 'correct horse' },
      'security-headers': {},
      'rate-limit': { average: 10, burst: 20 },
      'ip-allowlist': { cidrs: ['10.0.0.0/8', '203.0.113.7'] },
      'redirect-www': { direction: 'to-non-www' },
    };
    expect(PRESETS.map((p) => p.id).sort()).toEqual(
      Object.keys(samples).sort(),
    );
    for (const p of PRESETS) {
      const r = await buildPreset(p.id, samples[p.id]);
      expect(r.name).toBe(p.defaultName);
      const v = validateDynamicConfig(r.content);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.parsed.middlewares).toEqual([r.name]);
    }
  });

  it('basic auth stores a valid bcrypt hash, never the password', async () => {
    const r = await buildPreset('basic-auth', {
      name: 'staging-auth',
      username: 'alice',
      password: 'S3cret-pass!',
    });
    expect(r.name).toBe('staging-auth');
    expect(r.content).not.toContain('S3cret-pass!');
    const users = (
      mw(r.content, 'staging-auth').basicAuth as { users: string[] }
    ).users;
    expect(users).toHaveLength(1);
    const [user, hash] = users[0].split(/:(.+)/);
    expect(user).toBe('alice');
    expect(hash).toMatch(/^\$2y\$10\$/);
    // $2y$ is the same algorithm as $2b$; bcryptjs verifies it after switching back
    expect(await compare('S3cret-pass!', hash.replace('$2y$', '$2b$'))).toBe(
      true,
    );
    expect(await compare('wrong', hash.replace('$2y$', '$2b$'))).toBe(false);
  });

  it('htpasswdBcrypt only rewrites the version prefix', () => {
    expect(htpasswdBcrypt('$2b$10$abc')).toBe('$2y$10$abc');
    expect(htpasswdBcrypt('$2a$10$abc')).toBe('$2y$10$abc');
    expect(htpasswdBcrypt('$2y$10$abc')).toBe('$2y$10$abc');
  });

  it('rejects bad basic auth input', async () => {
    await expect(
      buildPreset('basic-auth', { username: 'a b', password: 'longenough' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      buildPreset('basic-auth', { username: 'a', password: 'short' }),
    ).rejects.toThrow(/password/);
    await expect(
      buildPreset('basic-auth', { username: 'a', password: 'two\nlines!!' }),
    ).rejects.toThrow(/password/);
    await expect(
      buildPreset('basic-auth', { username: 'a', password: 'é'.repeat(40) }),
    ).rejects.toThrow(/72 bytes/);
    await expect(
      buildPreset('basic-auth', {
        name: 'Bad Name',
        username: 'a',
        password: 'longenough',
      }),
    ).rejects.toThrow(/name/);
  });

  it('the audit log redacts the preset password', () => {
    const body = redactBody({
      params: { username: 'a', password: 'plain-secret' },
    });
    expect(JSON.stringify(body)).not.toContain('plain-secret');
    expect(JSON.stringify(body)).toContain('[redacted]');
  });

  it('security headers: HSTS only when asked, parameters bounded', async () => {
    const on = mw(
      (
        await buildPreset('security-headers', {
          stsSeconds: 600,
          stsPreload: true,
        })
      ).content,
      'security-headers',
    ).headers as Record<string, unknown>;
    expect(on).toMatchObject({
      stsSeconds: 600,
      stsPreload: true,
      frameDeny: true,
      contentTypeNosniff: true,
    });
    const off = mw(
      (await buildPreset('security-headers', { stsSeconds: 0 })).content,
      'security-headers',
    ).headers as Record<string, unknown>;
    expect(off.stsSeconds).toBeUndefined();
    await expect(
      buildPreset('security-headers', { stsSeconds: 99999999999 }),
    ).rejects.toThrow(/stsSeconds/);
    await expect(
      buildPreset('security-headers', { referrerPolicy: 'unsafe-url' }),
    ).rejects.toThrow(/referrerPolicy/);
  });

  it('rate limit needs average and burst within bounds', async () => {
    const rl = mw(
      (
        await buildPreset('rate-limit', {
          average: '5',
          burst: 9,
          period: '1m',
        })
      ).content,
      'rate-limit',
    ).rateLimit;
    expect(rl).toEqual({ average: 5, burst: 9, period: '1m' });
    await expect(buildPreset('rate-limit', { burst: 1 })).rejects.toThrow(
      /average/,
    );
    await expect(
      buildPreset('rate-limit', { average: 0, burst: 1 }),
    ).rejects.toThrow(/average/);
    await expect(
      buildPreset('rate-limit', { average: 1, burst: 1, period: '5s' }),
    ).rejects.toThrow(/period/);
  });

  it('ip allowlist validates every entry and de-duplicates', async () => {
    const r = await buildPreset('ip-allowlist', {
      cidrs: '10.0.0.0/8, 10.0.0.0/8\n2001:db8::/32',
    });
    expect(
      (mw(r.content, 'ip-allowlist').ipAllowList as { sourceRange: string[] })
        .sourceRange,
    ).toEqual(['10.0.0.0/8', '2001:db8::/32']);
    await expect(buildPreset('ip-allowlist', { cidrs: [] })).rejects.toThrow(
      /at least one/,
    );
    await expect(
      buildPreset('ip-allowlist', { cidrs: ['10.0.0.0/33'] }),
    ).rejects.toThrow(/not a valid/);
    await expect(
      buildPreset('ip-allowlist', { cidrs: ['not-an-ip'] }),
    ).rejects.toThrow(/not a valid/);
  });

  it('isIpOrCidr', () => {
    expect(isIpOrCidr('1.2.3.4')).toBe(true);
    expect(isIpOrCidr('1.2.3.4/32')).toBe(true);
    expect(isIpOrCidr('::1')).toBe(true);
    expect(isIpOrCidr('::1/129')).toBe(false);
    expect(isIpOrCidr('1.2.3.4/')).toBe(false);
    expect(isIpOrCidr('1.2.3.4/8/8')).toBe(false);
    expect(isIpOrCidr('999.1.1.1')).toBe(false);
  });

  it('redirect www builds permanent regex redirects in both directions', async () => {
    const a = mw(
      (await buildPreset('redirect-www', { direction: 'to-non-www' })).content,
      'redirect-www',
    ).redirectRegex as Record<string, unknown>;
    expect(a.permanent).toBe(true);
    expect(
      new RegExp(a.regex as string).test('https://www.example.com/x?y=1'),
    ).toBe(true);
    expect(
      'https://www.example.com/x?y=1'.replace(
        new RegExp(a.regex as string),
        '$1://$2',
      ),
    ).toBe('https://example.com/x?y=1');
    const b = mw(
      (await buildPreset('redirect-www', { direction: 'to-www' })).content,
      'redirect-www',
    ).redirectRegex as Record<string, unknown>;
    expect(
      'http://example.com/p'.replace(
        new RegExp(b.regex as string),
        '$1://www.$2',
      ),
    ).toBe('http://www.example.com/p');
    await expect(buildPreset('redirect-www', {})).rejects.toThrow(/direction/);
  });

  it('an unknown preset is a 400', async () => {
    await expect(buildPreset('nope', {})).rejects.toThrow(/Unknown preset/);
  });
});
