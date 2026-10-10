import { BadRequestException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { dump } from 'js-yaml';
import { isIP } from 'node:net';
import { ELEMENT_NAME } from './proxy-config-schema';

/** A form field a preset asks for; the web renders the form from this. */
export interface PresetField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'list';
  required: boolean;
  default?: string | number | boolean;
  options?: string[];
  hint?: string;
}

export interface PresetInfo {
  id: PresetId;
  label: string;
  description: string;
  /** Default middleware name; also the suggested file name. */
  defaultName: string;
  fields: PresetField[];
}

export interface PresetResult {
  /** Suggested file name (slug). */
  name: string;
  /** Ready-to-save YAML (a normal file afterwards: it can be edited). */
  content: string;
}

export const PRESET_IDS = [
  'basic-auth',
  'security-headers',
  'rate-limit',
  'ip-allowlist',
  'redirect-www',
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

const NAME_FIELD: PresetField = {
  key: 'name',
  label: 'Middleware name',
  type: 'text',
  required: false,
  hint: 'Lowercase letters, digits and "-". Used as the file name and as name@file.',
};

const REFERRER_POLICIES = [
  'no-referrer',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
] as const;

export const PRESETS: PresetInfo[] = [
  {
    id: 'basic-auth',
    label: 'Basic auth',
    description:
      'Ask for a username and password before a request reaches the application.',
    defaultName: 'basic-auth',
    fields: [
      { ...NAME_FIELD },
      { key: 'username', label: 'Username', type: 'text', required: true },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        required: true,
        hint: 'At least 8 characters. Only the bcrypt hash is stored in the file.',
      },
    ],
  },
  {
    id: 'security-headers',
    label: 'Security headers',
    description:
      'Common security headers: HSTS, nosniff, frame deny, referrer policy.',
    defaultName: 'security-headers',
    fields: [
      { ...NAME_FIELD },
      {
        key: 'stsSeconds',
        label: 'HSTS max-age (seconds)',
        type: 'number',
        required: false,
        default: 31536000,
        hint: '0 = no HSTS. HSTS is only sent over https.',
      },
      {
        key: 'stsIncludeSubdomains',
        label: 'HSTS for subdomains',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        key: 'stsPreload',
        label: 'HSTS preload',
        type: 'boolean',
        required: false,
        default: false,
      },
      {
        key: 'frameDeny',
        label: 'Refuse being embedded in a frame',
        type: 'boolean',
        required: false,
        default: true,
      },
      {
        key: 'contentTypeNosniff',
        label: 'X-Content-Type-Options: nosniff',
        type: 'boolean',
        required: false,
        default: true,
      },
      {
        key: 'referrerPolicy',
        label: 'Referrer-Policy',
        type: 'select',
        required: false,
        default: 'strict-origin-when-cross-origin',
        options: [...REFERRER_POLICIES],
      },
    ],
  },
  {
    id: 'rate-limit',
    label: 'Rate limit',
    description: 'Limit the number of requests per source IP.',
    defaultName: 'rate-limit',
    fields: [
      { ...NAME_FIELD },
      {
        key: 'average',
        label: 'Average requests per period',
        type: 'number',
        required: true,
        default: 100,
      },
      {
        key: 'burst',
        label: 'Burst',
        type: 'number',
        required: true,
        default: 50,
      },
      {
        key: 'period',
        label: 'Period',
        type: 'select',
        required: false,
        default: '1s',
        options: ['1s', '1m', '1h'],
      },
    ],
  },
  {
    id: 'ip-allowlist',
    label: 'IP allowlist',
    description:
      'Only allow certain addresses/CIDRs; everything else gets a 403.',
    defaultName: 'ip-allowlist',
    fields: [
      { ...NAME_FIELD },
      {
        key: 'cidrs',
        label: 'Address / CIDR',
        type: 'list',
        required: true,
        hint: 'One per line, e.g. 203.0.113.7 or 10.0.0.0/8. The client IP the proxy sees can be the IP of another proxy in front of it.',
      },
    ],
  },
  {
    id: 'redirect-www',
    label: 'Redirect www',
    description:
      'Permanently redirect www to non-www or the other way round. Attach it to the domain being redirected, not to the destination.',
    defaultName: 'redirect-www',
    fields: [
      { ...NAME_FIELD },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        required: true,
        default: 'to-non-www',
        options: ['to-non-www', 'to-www'],
        hint: 'to-non-www: attach to www.example.com. to-www: attach to example.com (without www).',
      },
    ],
  },
];

type Params = Record<string, unknown>;

function fail(message: string): never {
  throw new BadRequestException(message);
}

function nameOf(params: Params, fallback: string): string {
  const raw = params.name;
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string' || !ELEMENT_NAME.test(raw)) {
    fail('name: use lowercase letters, digits and "-" (max 63 characters)');
  }
  return raw;
}

function int(
  params: Params,
  key: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  const v = params[key];
  if (v === undefined || v === null || v === '') {
    if (fallback === undefined) fail(`${key} is required`);
    return fallback;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    fail(`${key} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function bool(params: Params, key: string, fallback: boolean): boolean {
  const v = params[key];
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fail(`${key} must be true or false`);
}

function oneOf<T extends string>(
  params: Params,
  key: string,
  options: readonly T[],
  fallback?: T,
): T {
  const v = params[key];
  if (v === undefined || v === null || v === '') {
    if (fallback === undefined) fail(`${key} is required`);
    return fallback;
  }
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) {
    fail(`${key} must be one of: ${options.join(', ')}`);
  }
  return v as T;
}

/** Pure: a plain IP or a CIDR (`10.0.0.0/8`, `2001:db8::/32`). */
export function isIpOrCidr(value: string): boolean {
  const [addr, bits, ...rest] = value.split('/');
  if (rest.length > 0) return false;
  const family = isIP(addr);
  if (family === 0) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (family === 4 ? 32 : 128);
}

function render(document: unknown, header: string): string {
  return `# ${header}\n${dump(document, { lineWidth: -1, quotingType: '"' })}`;
}

/**
 * `$2b$` and `$2y$` are the same algorithm; htpasswd (and so Traefik's
 * basicAuth) spells it `$2y$`.
 */
export function htpasswdBcrypt(bcryptHash: string): string {
  return bcryptHash.replace(/^\$2[ab]\$/, '$2y$');
}

/**
 * Builds the YAML for a preset. Pure apart from bcrypt for basic auth.
 * The result is stored like any hand-written file; the plaintext password is
 * never part of it.
 */
export async function buildPreset(
  id: string,
  params: Params,
): Promise<PresetResult> {
  switch (id) {
    case 'basic-auth': {
      const name = nameOf(params, 'basic-auth');
      const username = params.username;
      const password = params.password;
      if (
        typeof username !== 'string' ||
        !/^[A-Za-z0-9._-]{1,32}$/.test(username)
      ) {
        fail(
          'username: 1-32 characters from letters, digits, ".", "_" and "-"',
        );
      }
      if (
        typeof password !== 'string' ||
        password.length < 8 ||
        Buffer.byteLength(password, 'utf8') > 72 ||
        /[\r\n]/.test(password)
      ) {
        fail('password: 8 to 72 bytes (bcrypt limit), on one line');
      }
      const entry = `${username}:${htpasswdBcrypt(await hash(password, 10))}`;
      return {
        name,
        content: render(
          {
            http: {
              middlewares: {
                [name]: { basicAuth: { users: [entry], removeHeader: true } },
              },
            },
          },
          'aoox preset: basic auth (bcrypt hash only; generate a new preset to change it)',
        ),
      };
    }
    case 'security-headers': {
      const name = nameOf(params, 'security-headers');
      const stsSeconds = int(params, 'stsSeconds', 0, 63072000, 31536000);
      const headers: Record<string, unknown> = {
        contentTypeNosniff: bool(params, 'contentTypeNosniff', true),
        frameDeny: bool(params, 'frameDeny', true),
        referrerPolicy: oneOf(
          params,
          'referrerPolicy',
          REFERRER_POLICIES,
          'strict-origin-when-cross-origin',
        ),
      };
      if (stsSeconds > 0) {
        headers.stsSeconds = stsSeconds;
        headers.stsIncludeSubdomains = bool(
          params,
          'stsIncludeSubdomains',
          false,
        );
        headers.stsPreload = bool(params, 'stsPreload', false);
      }
      return {
        name,
        content: render(
          { http: { middlewares: { [name]: { headers } } } },
          'aoox preset: security headers',
        ),
      };
    }
    case 'rate-limit': {
      const name = nameOf(params, 'rate-limit');
      const average = int(params, 'average', 1, 100000);
      const burst = int(params, 'burst', 1, 100000);
      const period = oneOf(params, 'period', ['1s', '1m', '1h'] as const, '1s');
      return {
        name,
        content: render(
          {
            http: {
              middlewares: {
                [name]: { rateLimit: { average, burst, period } },
              },
            },
          },
          'aoox preset: rate limit per source IP',
        ),
      };
    }
    case 'ip-allowlist': {
      const name = nameOf(params, 'ip-allowlist');
      const raw = params.cidrs;
      const list = (
        Array.isArray(raw)
          ? raw.map((v) => String(v))
          : typeof raw === 'string'
            ? raw.split(/[\s,]+/)
            : []
      )
        .map((v) => v.trim())
        .filter((v) => v !== '');
      if (list.length === 0) fail('cidrs: add at least one address or CIDR');
      if (list.length > 100) fail('cidrs: at most 100 entries');
      const bad = list.find((v) => !isIpOrCidr(v));
      if (bad) fail(`cidrs: "${bad}" is not a valid IP address or CIDR`);
      return {
        name,
        content: render(
          {
            http: {
              middlewares: {
                [name]: { ipAllowList: { sourceRange: [...new Set(list)] } },
              },
            },
          },
          'aoox preset: IP allowlist',
        ),
      };
    }
    case 'redirect-www': {
      const name = nameOf(params, 'redirect-www');
      const direction = oneOf(params, 'direction', [
        'to-non-www',
        'to-www',
      ] as const);
      // Go's regexp has no look-ahead, so the middleware must be attached
      // only to the host being redirected (www.x for to-non-www, x for to-www).
      const redirectRegex =
        direction === 'to-non-www'
          ? {
              regex: '^(https?)://www\\.(.+)',
              replacement: '${1}://${2}',
              permanent: true,
            }
          : {
              regex: '^(https?)://(.+)',
              replacement: '${1}://www.${2}',
              permanent: true,
            };
      return {
        name,
        content: render(
          { http: { middlewares: { [name]: { redirectRegex } } } },
          direction === 'to-non-www'
            ? 'aoox preset: redirect www to non-www (attach to the www domain only)'
            : 'aoox preset: redirect non-www to www (attach to the apex domain only)',
        ),
      };
    }
    default:
      return fail(`Unknown preset "${id}"`);
  }
}
