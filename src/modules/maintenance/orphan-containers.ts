import type { ContainerSummary } from '../docker/docker-engine.client';

export type OrphanContainerKind =
  'application' | 'database' | 'companion' | 'compose';

export interface OrphanContainer {
  id: string;
  name: string;
  kind: OrphanContainerKind;
  image: string;
  state: string;
  /** The id (or, for a bare stack container, the slug) of the row that is gone. */
  ownerId: string;
}

/** The ids currently in the DB. A container whose owner is in here is never an orphan. */
export interface KnownOwners {
  applications: Set<string>;
  databases: Set<string>;
  composeApps: Set<string>;
  composeSlugs: Set<string>;
}

const STACK_PROJECT_PREFIX = 'aoox-';
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_WORKDIR_LABEL = 'com.docker.compose.project.working_dir';

/** The container's display name without Docker's leading slash. */
export function containerName(c: Pick<ContainerSummary, 'Names' | 'Id'>) {
  return (c.Names?.[0] ?? c.Id.slice(0, 12)).replace(/^\//, '');
}

/**
 * The aoox resource that owns this container, decided only from labels aoox
 * itself writes. `null` means "not an aoox workload, or the owner cannot be
 * determined": such a container is never reported, same strictness as
 * `isCandidateVolume`. The panel's own stack (compose project `aoox`), the
 * proxy, registry, buildkit, maintenance page server and every job/backup/
 * build/query helper carry another `aoox.component` and fall through here.
 */
export function ownerOf(
  c: Pick<ContainerSummary, 'Labels'>,
): { kind: OrphanContainerKind; ownerId: string; slug?: boolean } | null {
  const l = c.Labels ?? {};
  // Swarm tasks are recreated by their service: removing one achieves nothing.
  if (l['com.docker.swarm.service.id'] || l['com.docker.swarm.task.id']) {
    return null;
  }
  const component = l['aoox.component'];
  if (component === 'application' && l['aoox.application']) {
    return { kind: 'application', ownerId: l['aoox.application'] };
  }
  if (component === 'database' && l['aoox.database']) {
    return { kind: 'database', ownerId: l['aoox.database'] };
  }
  if (component === 'companion' && l['aoox.companion']) {
    return { kind: 'companion', ownerId: l['aoox.companion'] };
  }
  if (component === 'compose' && l['aoox.compose']) {
    return { kind: 'compose', ownerId: l['aoox.compose'] };
  }
  if (component) return null;

  // A stack container without our label (no domain/port/mount/limit override):
  // only recognised when it lives in `aoox-<slug>` AND was started from the
  // stack's own checkout volume, which only the compose runner mounts.
  const project = l[COMPOSE_PROJECT_LABEL] ?? '';
  if (!project.startsWith(STACK_PROJECT_PREFIX)) return null;
  const slug = project.slice(STACK_PROJECT_PREFIX.length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  const dir = l[COMPOSE_WORKDIR_LABEL] ?? '';
  if (!dir.includes(`/aoox_compose_${slug}/_data`)) return null;
  return { kind: 'compose', ownerId: slug, slug: true };
}

/**
 * aoox containers on the local daemon whose owning row no longer exists
 * (left behind by project/app deletes of older versions). Pure.
 */
export function orphanedContainers(
  containers: ContainerSummary[],
  known: KnownOwners,
): OrphanContainer[] {
  const out: OrphanContainer[] = [];
  for (const c of containers) {
    const owner = ownerOf(c);
    if (!owner) continue;
    const exists =
      owner.kind === 'application'
        ? known.applications.has(owner.ownerId)
        : owner.kind === 'database' || owner.kind === 'companion'
          ? known.databases.has(owner.ownerId)
          : owner.slug
            ? known.composeSlugs.has(owner.ownerId)
            : known.composeApps.has(owner.ownerId);
    if (exists) continue;
    out.push({
      id: c.Id,
      name: containerName(c),
      kind: owner.kind,
      image: c.Image,
      state: c.State,
      ownerId: owner.ownerId,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
