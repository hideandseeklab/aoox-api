import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ProxyService } from '../proxy/proxy.service';

/**
 * `docker-compose.override.yml` content for the panel's own `web`/`api`
 * services, in the same JSON-as-YAML shape `compose-runner`'s `renderOverride`
 * uses for app stacks. Named `docker-compose.override.yml` (not `.domain.yml`)
 * on purpose: Compose picks that filename up automatically next to
 * `docker-compose.dist.yml` on every future `up`, so once this is written the
 * domain survives `aoox update panel`/manual restarts without needing an explicit
 * `-f` flag forever after.
 */
export function renderPanelOverride(
  webHost: string,
  apiHost: string,
  opts: { httpsPort: number; acme: boolean; restrictPorts?: boolean },
): string {
  const web = ProxyService.buildLabels(
    'aoox-web',
    3000,
    [{ host: webHost, https: true }],
    opts,
  );
  const api = ProxyService.buildLabels(
    'aoox-api',
    3001,
    [{ host: apiHost, https: true }],
    opts,
  );
  if (opts.restrictPorts) return renderRestrictedOverride(web, api);
  return `${JSON.stringify(
    {
      services: {
        web: { labels: web },
        api: { labels: api },
      },
    },
    null,
    2,
  )}\n`;
}

const PORT_WEB = '127.0.0.1:${WEB_PORT:-3000}:3000';
const PORT_API = '127.0.0.1:${API_PORT:-3001}:3001';

/**
 * Same override plus `ports: !override [...]` that publishes 3000/3001 on the
 * loopback address only. Compose appends the `ports` of an override to the base
 * file's list, so a plain list could never replace `3000:3000`; the `!override`
 * tag (Compose >= 2.24.4) replaces it. A YAML tag cannot be written in JSON,
 * hence this separate rendering (JSON objects and strings are valid YAML flow
 * nodes, so the labels stay JSON-encoded). WEB_PORT/API_PORT are interpolated
 * by Compose exactly like in the base file. Only used while the owner has opted
 * into "only allow access through the domain": the default output above stays
 * byte-identical, so existing installs and older host Compose versions are
 * unaffected until then.
 */
function renderRestrictedOverride(
  web: Record<string, string>,
  api: Record<string, string>,
): string {
  return [
    '# Written by aoox (Settings -> Domain panel). "Only allow access through the domain" is on:',
    '# ports 3000/3001 listen on 127.0.0.1 only. Needs Docker Compose >= 2.24.4 (!override).',
    '# To open them again turn the option off in the dashboard, or delete the two "ports:" lines',
    '# and run: docker compose -f docker-compose.dist.yml -f docker-compose.override.yml --env-file .env.dist up -d',
    'services:',
    '  web:',
    `    labels: ${JSON.stringify(web)}`,
    `    ports: !override [${JSON.stringify(PORT_WEB)}]`,
    '  api:',
    `    labels: ${JSON.stringify(api)}`,
    `    ports: !override [${JSON.stringify(PORT_API)}]`,
    '',
  ].join('\n');
}

/**
 * Idempotently sets `KEY=value` lines in a `.env`-style file's content,
 * appending keys that are not already present and replacing the value of
 * ones that are (first match wins, same idea as a `sed` in-place substitution).
 * Pure so the panel-domain apply script can be unit-tested without a real
 * file or container.
 */
export function upsertEnvVars(
  content: string,
  vars: Record<string, string>,
): string {
  const lines = content.length ? content.split('\n') : [];
  // A file ending in "\n" splits with a trailing '' entry — drop it before
  // appending, so a new key lands at the end instead of before it.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    const index = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (index >= 0) lines[index] = line;
    else lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

/** Shown with the opt-in, in the dashboard, docs and API errors. */
export const RESTRICT_PORTS_RECOVERY =
  'If the domain stops working (DNS, firewall, certificate) you can no longer ' +
  'reach the panel on IP:3000. Recover over SSH: in the install folder delete the ' +
  'two "ports:" lines in docker-compose.override.yml, then run ' +
  '`docker compose -f docker-compose.dist.yml -f docker-compose.override.yml ' +
  '--env-file .env.dist up -d`.';

/**
 * Closing 3000/3001 is only safe with BOTH hosts: the CLI, webhooks and the
 * terminal/log sockets use PUBLIC_API_URL, and the dashboard itself lives on
 * the web host. Pure, so it is unit-tested without the service.
 */
export function assertRestrictPortsAllowed(
  webHost: string | null,
  apiHost: string | null,
  restrictPorts: boolean,
): void {
  if (restrictPorts && (!webHost || !apiHost)) {
    throw new BadRequestException(
      'restrictPorts needs both a web domain and an API domain: the CLI, ' +
        'webhooks and sockets reach the API through its domain once port 3001 is closed',
    );
  }
}

/**
 * Message for "the daemon cannot be reached" (502). Panel domain changes
 * recreate the panel's own containers through Docker, so there is nothing to
 * apply without a daemon; a plain 500 gave the owner no hint. HTTP exceptions
 * pass through unchanged. Pure, so it is unit-tested.
 */
export function toDaemonUnreachable(err: unknown): Error {
  if (
    err instanceof BadRequestException ||
    err instanceof BadGatewayException
  ) {
    return err;
  }
  const reason = err instanceof Error ? err.message : String(err);
  const short = reason.length > 160 ? `${reason.slice(0, 160)}...` : reason;
  return new BadGatewayException(
    `The Docker daemon is not reachable (${short}). Start Docker on the host ` +
      'and try again; nothing was changed.',
  );
}

/**
 * Shell script that takes the panel back to plain IP access: `.env.dist` gets
 * the values `aoox install` writes for a no-domain install (blank domains and
 * COOKIE_SECURE, IP-based origins from PUBLIC_IP/WEB_PORT/API_PORT already in
 * that file, `localhost` when PUBLIC_IP is empty), the override is deleted and
 * compose runs WITHOUT it so the Traefik labels and the loopback-only ports
 * go away. PROXY_ACME_EMAIL is deliberately kept: the shared proxy and every
 * application domain still need it. Keys are replaced when present and
 * appended otherwise (same idea as `envUpsertLine`, but the value is computed
 * by the shell, hence double quotes and `|` as the sed delimiter).
 */
export function renderClearDomainScript(installDir: string): string {
  const set = (key: string, value: string) =>
    `grep -q '^${key}=' .env.dist ` +
    `&& sed -i "s|^${key}=.*|${key}=${value}|" .env.dist ` +
    `|| echo "${key}=${value}" >> .env.dist`;
  return [
    'set -e',
    `cd ${installDir}`,
    'get() { grep -m1 "^$1=" .env.dist | cut -d= -f2- || true; }',
    'IP=$(get PUBLIC_IP); IP=${IP:-localhost}',
    'WP=$(get WEB_PORT); WP=${WP:-3000}',
    'AP=$(get API_PORT); AP=${AP:-3001}',
    set('WEB_DOMAIN', ''),
    set('API_DOMAIN', ''),
    set('COOKIE_SECURE', ''),
    set('WEB_ORIGIN', 'http://$IP:$WP'),
    set('PUBLIC_API_URL', 'http://$IP:$AP'),
    'rm -f docker-compose.override.yml',
    'docker compose -f docker-compose.dist.yml --env-file .env.dist up -d',
  ].join('\n');
}

/**
 * Address to reopen the dashboard on after the panel domain is removed:
 * `http://<PUBLIC_IP>:<WEB_PORT>`. `WEB_PORT` falls back to 3000 when empty,
 * unset (installs whose compose file predates the variable) or not a valid
 * port. Null when PUBLIC_IP is not configured.
 */
export function reopenUrlFor(
  publicIp?: string | null,
  webPort?: string | null,
): string | null {
  const ip = publicIp?.trim();
  if (!ip) return null;
  const raw = webPort?.trim() || '3000';
  const port =
    /^\d{1,5}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 65535
      ? raw
      : '3000';
  const host = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip;
  return `http://${host}:${Number(port)}`;
}
