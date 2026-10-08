import { isCandidateVolume } from '../maintenance/orphan-volumes';

/**
 * Pure classification of what aoox owns on a daemon, from labels and names
 * alone (no DB, no Docker calls). Everything the Docker manager refuses to
 * touch — and every "managed by aoox" badge — comes from here, so the guards
 * are unit-tested in one place.
 */

export type ManagedKind =
  | 'panel'
  | 'application'
  | 'database'
  | 'compose'
  | 'companion'
  | 'stack'
  | 'proxy'
  | 'registry'
  | 'build'
  | 'job'
  | 'backup'
  | 'component'
  | 'aoox';

export interface ManagedInfo {
  kind: ManagedKind;
  /** Resource page this container belongs to, when the labels name it. */
  link: { type: 'application' | 'database' | 'compose'; id: string } | null;
}

/** Compose project of the panel's own stack (postgres, api, web). */
export const PANEL_COMPOSE_PROJECT = 'aoox';
/** User stacks run as `aoox-<slug>` (compose-runner). */
const STACK_PREFIX = 'aoox-';

const COMPONENT_KINDS: Record<string, ManagedKind> = {
  proxy: 'proxy',
  registry: 'registry',
  build: 'build',
  job: 'job',
  backup: 'backup',
  application: 'application',
  database: 'database',
  compose: 'compose',
  companion: 'companion',
};

export function isAooxName(name: string): boolean {
  const n = name.replace(/^\//, '');
  return /^aoox[-_]/.test(n);
}

/**
 * Whether a container belongs to aoox. `selfHostname` is this API's own
 * container hostname (Docker sets it to the short container id), so the API
 * can never be stopped from its own page even if its labels were stripped.
 */
export function classifyContainer(
  c: { id: string; names: string[]; labels?: Record<string, string> | null },
  selfHostname?: string,
): ManagedInfo | null {
  const labels = c.labels ?? {};
  if (
    selfHostname &&
    /^[a-f0-9]{12,64}$/.test(selfHostname) &&
    c.id.startsWith(selfHostname)
  ) {
    return { kind: 'panel', link: null };
  }
  const project = labels['com.docker.compose.project'];

  if (labels['aoox.application']) {
    return {
      kind: 'application',
      link: { type: 'application', id: labels['aoox.application'] },
    };
  }
  if (labels['aoox.database']) {
    return {
      kind: 'database',
      link: { type: 'database', id: labels['aoox.database'] },
    };
  }
  if (labels['aoox.compose']) {
    return {
      kind: 'compose',
      link: { type: 'compose', id: labels['aoox.compose'] },
    };
  }
  if (labels['aoox.companion']) {
    return {
      kind: 'companion',
      link: { type: 'database', id: labels['aoox.companion'] },
    };
  }
  const component = labels['aoox.component'];
  if (component) {
    return { kind: COMPONENT_KINDS[component] ?? 'component', link: null };
  }
  // After the component check: aoox-proxy/registry carry both labels and should read as such.
  if (project === PANEL_COMPOSE_PROJECT) return { kind: 'panel', link: null };
  if (project?.startsWith(STACK_PREFIX)) return { kind: 'stack', link: null };
  if (c.names.some(isAooxName)) return { kind: 'aoox', link: null };
  return null;
}

/** A container id (64 hex) or a Docker-legal name; never anything else. */
export function isSafeContainerRef(ref: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(ref) || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(ref)
  );
}

/** `sha256:<hex>` or a bare 12–64 hex id, as the image list returns them. */
export function isSafeImageId(id: string): boolean {
  return /^(sha256:)?[a-f0-9]{12,64}$/.test(id);
}

/** Repository part of a tag without the registry host or tag: `host:5000/a/b:1` -> `a/b`. */
function repoPath(tag: string): string {
  const noTag = tag.replace(/:[^:/]+$/, '').replace(/@sha256:.*/, '');
  const parts = noTag.split('/');
  const first = parts[0];
  const hasHost =
    parts.length > 1 &&
    (first.includes('.') || first.includes(':') || first === 'localhost');
  return (hasHost ? parts.slice(1) : parts).join('/');
}

/** aoox's own images: helpers (`aoox-nixpacks`…), `aoox/<project>/<app>` (remote servers) and the panel images. */
export function isAooxImage(tags: string[] | null | undefined): boolean {
  return (tags ?? []).some((t) => {
    const repo = repoPath(t);
    return (
      /^aoox([-/]|$)/.test(repo) || /^hideandseeklab\/aoox([-/]|$)/.test(repo)
    );
  });
}

const BUILTIN_NETWORKS = new Set([
  'bridge',
  'host',
  'none',
  'ingress',
  'docker_gwbridge',
]);

export function isBuiltinNetwork(name: string): boolean {
  return BUILTIN_NETWORKS.has(name);
}

export function isAooxNetwork(
  name: string,
  labels?: Record<string, string> | null,
): boolean {
  const project = labels?.['com.docker.compose.project'];
  return (
    name === 'aoox' ||
    name === 'aoox-swarm' ||
    isAooxName(name) ||
    !!project?.startsWith('aoox')
  );
}

export function isAooxVolume(
  name: string,
  labels?: Record<string, string> | null,
): boolean {
  const project = labels?.['com.docker.compose.project'];
  return (
    isCandidateVolume(name) ||
    /^aoox[-_]/.test(name) ||
    !!project?.startsWith('aoox')
  );
}
