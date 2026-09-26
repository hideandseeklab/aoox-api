import { ProxyService } from '../proxy/proxy.service';

/**
 * `docker-compose.override.yml` content for the panel's own `web`/`api`
 * services, in the same JSON-as-YAML shape `compose-runner`'s `renderOverride`
 * uses for app stacks. Named `docker-compose.override.yml` (not `.domain.yml`)
 * on purpose: Compose picks that filename up automatically next to
 * `docker-compose.dist.yml` on every future `up`, so once this is written the
 * domain survives `aoox update`/manual restarts without needing an explicit
 * `-f` flag forever after.
 */
export function renderPanelOverride(
  webHost: string,
  apiHost: string,
  opts: { httpsPort: number; acme: boolean },
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
