import { createHash } from 'node:crypto';
import { MIDDLEWARE_REF } from '../proxy/middleware-ref';

/**
 * Traefik file-provider configuration of maintenance mode. Routing is changed
 * here, not in the application's container labels: the app container is never
 * recreated for a toggle, and the routers keep working while the app is down
 * or redeployed (a deploy rewrites the container's labels, this file still
 * outranks them through `priority`).
 *
 * Files in the proxy's dynamic directory (`aoox_proxy_certs`):
 * - `aoox-maintenance.yml`: the one service that answers with 503 (the shared
 *   nginx container `aoox-maintenance`). Written once, referenced by all apps.
 * - `aoox-maint-<appId>.yml`: one application's routers and its header
 *   middleware (sets `X-Aoox-App` so the page is the application's own).
 */
export const MAINTENANCE_SERVICE = 'aoox-maintenance';
export const MAINTENANCE_CONTAINER = 'aoox-maintenance';
export const MAINTENANCE_IMAGE = 'nginx:1.27-alpine';
/** Volume with one `<appId>.html` per application in maintenance (+ `default.html`). */
export const MAINTENANCE_VOLUME = 'aoox_maintenance';
export const MAINTENANCE_SHARED_FILE = 'aoox-maintenance.yml';
/** Above Traefik's default priority (the rule length) of the docker routers. */
export const MAINTENANCE_PRIORITY = 1000000;

const HOST = /^[a-z0-9.-]+$/;

export interface MaintenanceDomain {
  host: string;
  https: boolean;
  customCert: boolean;
  /** Operator middlewares (`name@file`), kept in front of the maintenance page. */
  middlewares: string[];
}

export function appDynamicFileName(appId: string): string {
  return `aoox-maint-${appId}.yml`;
}

export function appPageFileName(appId: string): string {
  return `${appId}.html`;
}

/** JSON is valid YAML, so the renderer does not need a YAML library. */
export function toDynamicYaml(config: object): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function sharedDynamicConfig(): object {
  return {
    http: {
      services: {
        [MAINTENANCE_SERVICE]: {
          loadBalancer: {
            servers: [{ url: `http://${MAINTENANCE_CONTAINER}:80` }],
          },
        },
      },
    },
  };
}

/**
 * Routers of one application. Host classes mirror `ProxyService.buildLabels`
 * so each host answers on the same entrypoints it does normally:
 * - plain hosts (and https hosts without ACME): `web`;
 * - https hosts with ACME: `websecure` with the ACME resolver, and no `web`
 *   router, so the docker `-redirect` router still sends http to https;
 * - https hosts with an uploaded certificate: `websecure` with `tls: {}`
 *   (Traefik picks the certificate by SNI; nothing is requested from ACME),
 *   no `web` router, same reasoning as above.
 * Returns null when the application has no domains (nothing to route).
 */
export function appDynamicConfig(
  appId: string,
  domains: MaintenanceDomain[],
  opts: { acme: boolean },
): object | null {
  const hosts = domains.filter((d) => HOST.test(d.host));
  if (hosts.length === 0) return null;
  const base = `aoox-maint-${appId}`;
  const hdr = `${base}-hdr`;
  const acmeSecure = hosts.filter((d) => opts.acme && d.https && !d.customCert);
  const custom = hosts.filter((d) => d.https && d.customCert);
  const plain = hosts.filter(
    (d) => !acmeSecure.includes(d) && !custom.includes(d),
  );

  const routers: Record<string, object> = {};
  const addGroups = (
    group: MaintenanceDomain[],
    cls: string,
    entrypoint: 'web' | 'websecure',
    tls: object | null,
  ) => {
    for (const g of groupByMiddlewares(group)) {
      const name = `${base}-${cls}${g.suffix}`;
      routers[name] = {
        rule: g.hosts.map((h) => `Host(\`${h}\`)`).join(' || '),
        entryPoints: [entrypoint],
        service: `${MAINTENANCE_SERVICE}@file`,
        middlewares: [...g.middlewares, `${hdr}@file`],
        priority: MAINTENANCE_PRIORITY,
        ...(tls ? { tls } : {}),
      };
    }
  };
  addGroups(plain, 'web', 'web', null);
  addGroups(acmeSecure, 'secure', 'websecure', { certResolver: 'le' });
  addGroups(custom, 'secure-custom', 'websecure', {});

  return {
    http: {
      routers,
      middlewares: {
        [hdr]: {
          headers: { customRequestHeaders: { 'X-Aoox-App': appId } },
        },
      },
    },
  };
}

/** Valid middleware refs, in order, without repeats. */
function middlewaresOf(d: MaintenanceDomain): string[] {
  return [...new Set(d.middlewares)].filter((m) => MIDDLEWARE_REF.test(m));
}

/**
 * Same grouping as ProxyService (`byMiddlewares`): hosts with the same
 * middleware list share a router; the group without middlewares has no suffix.
 */
function groupByMiddlewares(
  domains: MaintenanceDomain[],
): Array<{ suffix: string; middlewares: string[]; hosts: string[] }> {
  const groups = new Map<
    string,
    { suffix: string; middlewares: string[]; hosts: string[] }
  >();
  for (const d of domains) {
    const middlewares = middlewaresOf(d);
    const key = middlewares.join(',');
    let g = groups.get(key);
    if (!g) {
      const suffix =
        key === ''
          ? ''
          : `-m${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
      g = { suffix, middlewares, hosts: [] };
      groups.set(key, g);
    }
    g.hosts.push(d.host);
  }
  return [...groups.values()];
}
