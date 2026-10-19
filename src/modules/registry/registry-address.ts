import { isIP } from 'net';

/** Host address the registry's port is published on by default: this machine only. */
export const DEFAULT_PUBLISH_ADDRESS = '127.0.0.1';

/**
 * `REGISTRY_PUBLISH_ADDRESS` -> the `HostIp` of the registry's port binding.
 * Empty/unset means loopback only. `0.0.0.0` (or an interface address) exposes
 * the registry to other machines by IP. Anything that is not an IP literal is
 * ignored (loopback) rather than handed to Docker.
 */
export function publishAddressFrom(raw: string | undefined | null): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_PUBLISH_ADDRESS;
  return isIP(value) ? value : DEFAULT_PUBLISH_ADDRESS;
}

export function isLoopbackAddress(address: string): boolean {
  return address === '::1' || address.startsWith('127.');
}

export interface PortBinding {
  HostIp: string;
  HostPort: string;
}

export function registryPortBinding(
  address: string,
  port: number,
): { '5000/tcp': PortBinding[] } {
  return { '5000/tcp': [{ HostIp: address, HostPort: String(port) }] };
}

export interface RegistryAddressInput {
  /** `registries.domain` (served through the proxy). */
  domain: string | null;
  publishAddress: string;
  port: number;
  /** `REGISTRY_PUBLIC_HOST` when the operator set a non-localhost value. */
  publicHost: string | null;
  /** The server's public IP (`PUBLIC_IP` or auto-detected), if known. */
  publicIp: string | null;
}

export interface RegistryAddress {
  /** Address other machines can use for `docker login` / `docker push`; null when none. */
  externalAddress: string | null;
  /** True when the registry is only reachable from this server. */
  localOnly: boolean;
  publishAddress: string;
}

/**
 * What to show as "the push address". `registries.url` itself is NOT changed by
 * this: it is the image-reference prefix the host daemon pushes to and pulls
 * from, and Docker refuses plain-http registries other than localhost unless
 * they are listed in `insecure-registries`, so it stays `localhost:<port>`
 * (or the domain).
 */
export function describeRegistryAddress(
  input: RegistryAddressInput,
): RegistryAddress {
  const { domain, publishAddress, port, publicHost, publicIp } = input;
  if (domain) {
    return { externalAddress: domain, localOnly: false, publishAddress };
  }
  if (isLoopbackAddress(publishAddress)) {
    return { externalAddress: null, localOnly: true, publishAddress };
  }
  const host = publicHost ?? publicIp;
  return {
    externalAddress: host ? `${host}:${port}` : null,
    localOnly: false,
    publishAddress,
  };
}

/**
 * The interface the RUNNING registry container is actually published on, read
 * from Docker's port list (an existing install keeps its old 0.0.0.0 binding
 * until the container is recreated, whatever the env says now). Any
 * non-loopback entry wins (Docker lists IPv4 and IPv6 separately). Falls back
 * to `fallback` (the env value) when the container is stopped or unpublished.
 */
export function effectivePublishAddress(
  ports:
    { IP?: string; PrivatePort: number; PublicPort?: number }[] | undefined,
  fallback: string,
): string {
  const bound = (ports ?? [])
    .filter((p) => p.PrivatePort === 5000 && p.PublicPort && p.IP)
    .map((p) => p.IP as string);
  if (bound.length === 0) return fallback;
  return bound.find((ip) => !isLoopbackAddress(ip)) ?? bound[0];
}
