import type { ContainerSummary } from '../docker/docker-engine.client';

const ROUTER_RULE = /^traefik\.http\.routers\.[^.]+\.rule$/;
const HOST_CALL = /Host\(\s*((?:[`"'][^`"']*[`"']\s*,?\s*)+)\)/gi;
const QUOTED = /[`"']([^`"']*)[`"']/g;

/**
 * Hosts named by the `Host(...)` matchers of one Traefik rule, lower-cased.
 * Handles several hosts in one call (`Host(\`a\`, \`b\`)`), several calls
 * joined by `||`/`&&`, backticks or quotes. `HostRegexp` is not a `Host(`
 * call and is ignored.
 */
export function hostsInRule(rule: string): string[] {
  const hosts: string[] = [];
  for (const call of rule.matchAll(HOST_CALL)) {
    for (const q of call[1].matchAll(QUOTED)) {
      const h = q[1].trim().toLowerCase();
      if (h) hosts.push(h);
    }
  }
  return hosts;
}

/** Every host a container's Traefik router labels route to it. */
export function routedHosts(labels: Record<string, string> | undefined) {
  const hosts = new Set<string>();
  for (const [k, v] of Object.entries(labels ?? {})) {
    if (!ROUTER_RULE.test(k)) continue;
    for (const h of hostsInRule(v)) hosts.add(h);
  }
  return hosts;
}

export interface HostClaim {
  container: ContainerSummary;
  hosts: Set<string>;
}

/** States in which Traefik's docker provider still serves a container. */
const SERVING = new Set(['running', 'restarting', 'paused']);

/**
 * Containers other than the app's own that route any of `hosts`. `isOwn`
 * decides what belongs to the app being checked (its container, `-next`,
 * previews, swarm tasks). Pure.
 */
export function claimsOnHosts(
  containers: ContainerSummary[],
  hosts: string[],
  isOwn: (c: ContainerSummary) => boolean,
): Map<string, ContainerSummary[]> {
  const wanted = hosts.map((h) => h.toLowerCase());
  const result = new Map<string, ContainerSummary[]>(
    wanted.map((h) => [h, []]),
  );
  for (const c of containers) {
    if (!SERVING.has(c.State) || isOwn(c)) continue;
    const routed = routedHosts(c.Labels);
    for (const h of wanted) {
      if (routed.has(h)) result.get(h)!.push(c);
    }
  }
  return result;
}
