import { load } from 'js-yaml';

/** Per-file ceiling; these are small hand-written documents. */
export const MAX_CONFIG_BYTES = 64 * 1024;
/** Every file this feature writes starts with this, so the certificate module never touches it. */
export const USER_FILE_PREFIX = 'user-';
/** Slug of a config file (the part between `user-` and `.yml`). */
export const CONFIG_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A Traefik element (middleware/router/service/transport) name declared in a file. */
export const ELEMENT_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
export { MIDDLEWARE_REF } from '../proxy/middleware-ref';

const HTTP_SECTIONS = [
  'middlewares',
  'routers',
  'services',
  'serversTransports',
] as const;
const REFUSED_TOP: Record<string, string> = {
  tls: 'TLS is managed by aoox: upload certificates under Settings > Certificates',
  tcp: 'TCP routing is not supported here',
  udp: 'UDP routing is not supported here',
};

export function userFileName(name: string): string {
  if (!CONFIG_NAME.test(name)) throw new Error(`Invalid config name "${name}"`);
  return `${USER_FILE_PREFIX}${name}.yml`;
}

export interface ParsedConfig {
  /** Middleware names declared (without `@file`), sorted. */
  middlewares: string[];
  routers: string[];
  services: string[];
}

export type ValidationResult =
  { ok: true; parsed: ParsedConfig } | { ok: false; errors: string[] };

const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Structural validation of one Traefik dynamic-configuration document
 * (file provider). Pure. It parses YAML and checks the shape, not Traefik's
 * per-middleware options: Traefik itself reports those, and the sync service
 * reads that back after writing. Only `http` with `middlewares`, `routers`,
 * `services` and `serversTransports` is accepted; certificates (`tls`) belong
 * to the certificate module, and TCP/UDP are out of scope.
 */
export function validateDynamicConfig(content: string): ValidationResult {
  if (Buffer.byteLength(content, 'utf8') > MAX_CONFIG_BYTES) {
    return {
      ok: false,
      errors: [`The file is larger than ${MAX_CONFIG_BYTES / 1024} KB`],
    };
  }
  let doc: unknown;
  try {
    doc = load(content);
  } catch (err) {
    const e = err as { reason?: string; mark?: { line: number } };
    const where = e.mark ? ` (line ${e.mark.line + 1})` : '';
    return {
      ok: false,
      errors: [`Invalid YAML: ${e.reason ?? 'could not be parsed'}${where}`],
    };
  }
  if (!isMap(doc)) {
    return {
      ok: false,
      errors: ['The document must be a YAML mapping with an "http" section'],
    };
  }
  const errors: string[] = [];
  for (const key of Object.keys(doc)) {
    if (key === 'http') continue;
    errors.push(
      REFUSED_TOP[key]
        ? `"${key}" is not allowed: ${REFUSED_TOP[key]}`
        : `Unknown top-level key "${key}"; only "http" is allowed`,
    );
  }
  const parsed: ParsedConfig = { middlewares: [], routers: [], services: [] };
  const http = doc.http;
  if (http === undefined) {
    errors.push('Missing the "http" section');
  } else if (!isMap(http)) {
    errors.push('"http" must be a mapping');
  } else {
    for (const section of Object.keys(http)) {
      if (!(HTTP_SECTIONS as readonly string[]).includes(section)) {
        errors.push(
          `Unknown key "http.${section}"; allowed: ${HTTP_SECTIONS.join(', ')}`,
        );
        continue;
      }
      const body = http[section];
      if (!isMap(body)) {
        errors.push(`"http.${section}" must be a mapping of name to settings`);
        continue;
      }
      for (const [name, value] of Object.entries(body)) {
        if (!ELEMENT_NAME.test(name)) {
          errors.push(
            `Invalid name "${name}" in http.${section}: use lowercase letters, digits and "-" (max 63 characters)`,
          );
        } else if (!isMap(value)) {
          errors.push(`"http.${section}.${name}" must be a mapping`);
        } else if (
          section === 'middlewares' ||
          section === 'routers' ||
          section === 'services'
        ) {
          parsed[section].push(name);
        }
      }
    }
    const declared =
      parsed.middlewares.length +
      parsed.routers.length +
      parsed.services.length +
      Object.keys(isMap(http.serversTransports) ? http.serversTransports : {})
        .length;
    if (errors.length === 0 && declared === 0) {
      errors.push('The file declares nothing under "http"');
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  parsed.middlewares.sort();
  parsed.routers.sort();
  parsed.services.sort();
  return { ok: true, parsed };
}

/** Pure: referenced middleware names (`x@file` form) for a set of declared names. */
export function middlewareRefs(names: readonly string[]): string[] {
  return names.map((n) => `${n}@file`);
}
