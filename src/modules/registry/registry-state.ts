import type { SelfHostedStatus } from './self-hosted-registry.service';

/**
 * How the Docker container named `aoox-registry` relates to the self-hosted
 * `registries` row. The two are independent sources of truth (an instance
 * restore, a DB move or a leftover container can make them disagree), so the
 * UI must not infer "enabled" from only one of them.
 *
 * - `docker-unavailable`: the daemon cannot be reached, nothing else is known.
 * - `not-installed`: no container and no row.
 * - `installed`: container and row both exist (the normal case).
 * - `unmanaged-container`: a container exists but aoox has no row for it.
 * - `missing-container`: aoox has a row but the container is gone.
 */
export type SelfHostedState =
  | 'docker-unavailable'
  | 'not-installed'
  | 'installed'
  | 'unmanaged-container'
  | 'missing-container';

export function deriveSelfHostedState(
  dockerAvailable: boolean,
  container: Pick<SelfHostedStatus, 'installed'>,
  hasRegistryRow: boolean,
): SelfHostedState {
  if (!dockerAvailable) return 'docker-unavailable';
  if (container.installed) {
    return hasRegistryRow ? 'installed' : 'unmanaged-container';
  }
  return hasRegistryRow ? 'missing-container' : 'not-installed';
}
