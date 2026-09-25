/**
 * Splits an image reference the way Docker does (`nginx:1.27`,
 * `ghcr.io/org/app:1.2`, `localhost:5000/repo@sha256:…`): a first segment
 * with a dot, a colon or `localhost` is the registry, Docker Hub is
 * `registry-1.docker.io` with `library/` for official images.
 * Pure, unit-tested.
 */
export interface ImageReference {
  /** Registry host (with port), e.g. `registry-1.docker.io`, `ghcr.io`, `localhost:5000`. */
  registry: string;
  /** Path inside the registry, e.g. `library/nginx`, `org/app`. */
  repository: string;
  tag: string;
  /** Present when the reference pins a digest (`@sha256:…`) — such images never change. */
  digest: string | null;
}

export const DOCKER_HUB = 'registry-1.docker.io';

export function parseImageRef(ref: string): ImageReference {
  let rest = ref.trim();
  let digest: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  const firstSlash = rest.indexOf('/');
  const first = firstSlash >= 0 ? rest.slice(0, firstSlash) : '';
  let registry = DOCKER_HUB;
  let path = rest;
  if (
    firstSlash >= 0 &&
    (first.includes('.') || first.includes(':') || first === 'localhost')
  ) {
    registry = first;
    path = rest.slice(firstSlash + 1);
  }
  if (registry === 'docker.io' || registry === 'index.docker.io') {
    registry = DOCKER_HUB;
  }
  let tag = 'latest';
  const lastSlash = path.lastIndexOf('/');
  const colon = path.lastIndexOf(':');
  if (colon > lastSlash) {
    tag = path.slice(colon + 1);
    path = path.slice(0, colon);
  }
  if (registry === DOCKER_HUB && !path.includes('/')) path = `library/${path}`;
  return { registry, repository: path, tag, digest };
}
