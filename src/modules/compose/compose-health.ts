import type { ContainerInspect } from '../docker/docker-engine.client';

/**
 * How long a deploy/start waits for the stack's health-checked containers.
 * Longer than an application's health wait on purpose: stacks are databases,
 * CMSs and tools whose images declare their own start periods (uptime-kuma
 * declares 180 s; first-boot database init is slow on a small VPS), and
 * failing a stack that is merely slow is worse than waiting.
 */
export const STACK_HEALTH_WAIT_MS = 300_000;
export const STACK_HEALTH_POLL_MS = 2_000;

export type StackHealth =
  | { state: 'ready' }
  | { state: 'waiting'; pending: string[] }
  | { state: 'failed'; service: string; reason: string };

/** Compose service name of a container (falls back to its container name). */
export function serviceOf(c: ContainerInspect): string {
  return (
    c.Config.Labels?.['com.docker.compose.service'] ??
    c.Name?.replace(/^\//, '') ??
    c.Id.slice(0, 12)
  );
}

/**
 * Decides from inspected containers of one compose project:
 * - a RUNNING container with a health check must report `healthy`; `starting`
 *   waits, `unhealthy` fails at once with the last probe output;
 * - a container without a health check only has to exist (compose `up -d`
 *   already started it), and a container that is not running (a one-shot job,
 *   `restart: "no"`) never blocks, so migration services do not fail a deploy.
 */
export function evaluateStackHealth(
  containers: ContainerInspect[],
): StackHealth {
  const pending: string[] = [];
  for (const c of containers) {
    const health = c.State.Health;
    if (!c.State.Running || !health || health.Status === 'none') continue;
    if (health.Status === 'unhealthy') {
      return {
        state: 'failed',
        service: serviceOf(c),
        reason: describeUnhealthy(health.Log?.at(-1)),
      };
    }
    if (health.Status !== 'healthy') pending.push(serviceOf(c));
  }
  return pending.length
    ? { state: 'waiting', pending: [...new Set(pending)].sort() }
    : { state: 'ready' };
}

/** Last health log line as one short sentence (the output is the probe's, not the app's logs). */
export function describeUnhealthy(
  last: { ExitCode: number; Output: string } | undefined,
): string {
  if (!last) return 'its health check reported unhealthy';
  const out = last.Output.trim().replace(/\s+/g, ' ').slice(0, 200);
  return `its health check failed (exit ${last.ExitCode}${out ? `: ${out}` : ''})`;
}
