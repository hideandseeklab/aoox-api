import { existsSync } from 'fs';

/** Container name and in-container port of the self-hosted registry on the `aoox` network. */
export const REGISTRY_NETWORK_URL = 'http://aoox-registry:5000';

/** `host.docker.internal` is what compose files before the loopback-only binding pointed at. */
const LEGACY_HOST = /^https?:\/\/host\.docker\.internal(:|\/|$)/i;

/**
 * Where the API process reaches the self-hosted registry.
 *
 * The published host port is bound to 127.0.0.1 by default, and a service bound
 * to loopback is not reachable through `host.docker.internal` (the Docker bridge
 * gateway) on Linux. Inside a container the API therefore talks to the registry
 * over the `aoox` network by container name; an older compose file that still
 * sets `REGISTRY_INTERNAL_URL=http://host.docker.internal:5000` is treated the
 * same way, so an update does not break the registry. Any other explicit value
 * wins; outside Docker (dev) the stored address is used.
 */
export function selfHostedApiBaseUrl(
  internalUrl: string | undefined,
  storedUrl: string,
  inDocker: boolean,
): string {
  const explicit = internalUrl?.trim();
  if (explicit && !(inDocker && LEGACY_HOST.test(explicit))) return explicit;
  if (inDocker) return REGISTRY_NETWORK_URL;
  return `http://${storedUrl}`;
}

export const runningInDocker = (): boolean => existsSync('/.dockerenv');
