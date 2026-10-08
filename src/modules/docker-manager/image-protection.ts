/**
 * Pure matching used to keep the Docker page from deleting images aoox still
 * needs: a rollback target, a running app's image, an open preview, or anything
 * that lives under aoox's own local registry. No DB, no Docker calls here.
 */

export interface ParsedImageRef {
  /** Canonical `host/path` (Docker Hub = `docker.io/library/nginx`). */
  name: string;
  tag: string | null;
  digest: string | null;
}

export interface ImageLike {
  Id: string;
  RepoTags?: string[] | null;
  RepoDigests?: string[] | null;
}

export type RefKind = 'application' | 'deployment' | 'preview';

export interface ProtectionSources {
  /** `host[:port]` of aoox's own registries, lowercase (host daemon only). */
  registryHosts: Set<string>;
  refs: { ref: string; kind: RefKind }[];
}

const HUB_HOSTS = new Set([
  'docker.io',
  'index.docker.io',
  'registry-1.docker.io',
]);

function looksLikeHost(part: string): boolean {
  return part.includes('.') || part.includes(':') || part === 'localhost';
}

/** `host[:port]/path[:tag][@sha256:…]` → canonical parts; null when it cannot be an image ref. */
export function parseImageRef(ref: string): ParsedImageRef | null {
  let rest = ref.trim();
  if (!rest || /\s/.test(rest)) return null;
  let digest: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    digest = rest.slice(at + 1).toLowerCase();
    rest = rest.slice(0, at);
  }
  let tag: string | null = null;
  const slash = rest.lastIndexOf('/');
  const colon = rest.lastIndexOf(':');
  if (colon > slash) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  if (!rest) return null;
  const parts = rest.split('/');
  let host = 'docker.io';
  if (parts.length > 1 && looksLikeHost(parts[0])) {
    host = parts.shift()!.toLowerCase();
    if (HUB_HOSTS.has(host)) host = 'docker.io';
  }
  if (host === 'docker.io' && parts.length === 1) parts.unshift('library');
  if (!tag && !digest) tag = 'latest';
  return { name: `${host}/${parts.join('/')}`, tag, digest };
}

/** Registry host[:port] of a tag, or null for Docker Hub images. */
export function registryHostOf(tag: string): string | null {
  const parsed = parseImageRef(tag);
  if (!parsed) return null;
  const host = parsed.name.split('/')[0];
  return host === 'docker.io' ? null : host;
}

/** `https://Registry.example.com/` or `localhost:5000` → `registry.example.com` / `localhost:5000`. */
export function normalizeRegistryHost(urlOrHost: string): string {
  return urlOrHost
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

const IMAGE_ID = /^(sha256:)?[a-f0-9]{12,64}$/;

/**
 * Whether a DB-stored reference points at this image: by id, by repo+tag
 * (Docker Hub spellings and a missing `:latest` normalized) or by digest.
 */
export function imageMatchesRef(image: ImageLike, ref: string): boolean {
  if (IMAGE_ID.test(ref)) {
    const wanted = ref.replace(/^sha256:/, '');
    return image.Id.replace(/^sha256:/, '').startsWith(wanted);
  }
  const wanted = parseImageRef(ref);
  if (!wanted) return false;
  if (wanted.tag) {
    for (const t of image.RepoTags ?? []) {
      const have = parseImageRef(t);
      if (have && have.name === wanted.name && have.tag === wanted.tag) {
        return true;
      }
    }
  }
  if (wanted.digest) {
    for (const d of image.RepoDigests ?? []) {
      const have = parseImageRef(d);
      if (have && have.name === wanted.name && have.digest === wanted.digest) {
        return true;
      }
    }
  }
  return false;
}

const KIND_TEXT: Record<RefKind, string> = {
  application: 'the image an application is running',
  deployment: 'a deployment kept for rollback',
  preview: 'an open pull-request preview',
};

/**
 * Why this image must not be removed from the Docker page, or null. The
 * registry-host rule only applies on the host daemon (`localRegistry`): the
 * registry lives there, remote servers just hold pulled copies.
 */
export function protectionReason(
  image: ImageLike,
  sources: ProtectionSources,
  localRegistry: boolean,
): string | null {
  if (localRegistry) {
    for (const tag of image.RepoTags ?? []) {
      const host = registryHostOf(tag);
      if (host && sources.registryHosts.has(host)) {
        return `This image belongs to aoox's local registry (${host}); remove it from Registry.`;
      }
    }
  }
  for (const { ref, kind } of sources.refs) {
    if (imageMatchesRef(image, ref)) {
      return `This image is still referenced by ${KIND_TEXT[kind]} (${ref}); removing it would break that.`;
    }
  }
  return null;
}
