import { Application } from '../application/application.entity';
import {
  filesVolumeFor,
  MountOwner,
  volumeNameFor,
} from '../application/mounts';
import { Mount } from '../application/mount.entity';
import { BUILDKIT_VOLUME } from '../application/railpack-builder.service';
import { ComposeApp } from '../compose/compose-app.entity';
import { composeVolumeFor } from '../compose/compose.service';
import { BACKUPS_VOLUME } from '../database-backup/backups-volume';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { volumeNameForDb } from '../managed-database/managed-database.service';
import { PROXY_ACME_VOLUME } from '../proxy/proxy.service';
import {
  REGISTRY_AUTH_VOLUME,
  REGISTRY_DATA_VOLUME,
} from '../registry/self-hosted-registry.service';

/**
 * Fixed, singleton volumes aoox creates itself, independent of any
 * project row.
 */
const FIXED_VOLUMES = [
  BUILDKIT_VOLUME,
  PROXY_ACME_VOLUME,
  REGISTRY_DATA_VOLUME,
  REGISTRY_AUTH_VOLUME,
  BACKUPS_VOLUME,
];

/**
 * Prefixes of the per-project volumes aoox creates (`mounts.ts`,
 * `managed-database.service.ts`, `compose.service.ts`). A volume is only
 * ever a *candidate* for pruning when it matches one of these prefixes or
 * `FIXED_VOLUMES` exactly — everything else (including, critically, the
 * panel's own Postgres volume in `docker-compose.dist.yml`, which compose
 * names `aoox_postgres_data` — inside the same `aoox_` family
 * by coincidence of the project name) is left alone without even being
 * reported. Loose prefix matching on `aoox_` alone would have caught
 * that volume as "orphaned" the moment this feature shipped.
 */
const CANDIDATE_PREFIXES = ['aoox_app_', 'aoox_db_', 'aoox_compose_'];

export function isCandidateVolume(name: string): boolean {
  return (
    FIXED_VOLUMES.includes(name) ||
    CANDIDATE_PREFIXES.some((p) => name.startsWith(p))
  );
}

/**
 * Every Docker volume name aoox still needs, computed purely from DB
 * rows (no Docker calls) so it can be unit-tested without a daemon. Reuses
 * the same name generators the runners use to create these volumes, so the
 * two can never drift apart silently.
 */
export function expectedVolumes(input: {
  applications: Array<Pick<Application, 'id' | 'appName'>>;
  managedDatabases: Array<Pick<ManagedDatabase, 'id' | 'slug' | 'engine'>>;
  composeApps: Array<Pick<ComposeApp, 'id' | 'slug'>>;
  mounts: Array<
    Pick<
      Mount,
      | 'applicationId'
      | 'databaseId'
      | 'composeAppId'
      | 'type'
      | 'name'
      | 'service'
    >
  >;
}): Set<string> {
  const expected = new Set<string>(FIXED_VOLUMES);
  const apps = new Map(input.applications.map((a) => [a.id, a]));
  const dbs = new Map(input.managedDatabases.map((d) => [d.id, d]));
  const composeApps = new Map(input.composeApps.map((c) => [c.id, c]));

  for (const db of input.managedDatabases) {
    expected.add(volumeNameForDb(db as ManagedDatabase));
  }
  for (const c of input.composeApps) {
    expected.add(composeVolumeFor(c as ComposeApp));
  }

  for (const m of input.mounts) {
    const owner = ownerFor(m, apps, dbs, composeApps);
    if (!owner) continue;
    if (m.type === 'volume') expected.add(volumeNameFor(owner, m as Mount));
    else if (m.type === 'file') expected.add(filesVolumeFor(owner));
  }
  return expected;
}

function ownerFor(
  m: Pick<Mount, 'applicationId' | 'databaseId' | 'composeAppId'>,
  apps: Map<string, Pick<Application, 'id' | 'appName'>>,
  dbs: Map<string, Pick<ManagedDatabase, 'id' | 'slug' | 'engine'>>,
  composeApps: Map<string, Pick<ComposeApp, 'id' | 'slug'>>,
): MountOwner | null {
  if (m.applicationId) {
    const a = apps.get(m.applicationId);
    return a ? { appName: a.appName } : null;
  }
  if (m.databaseId) {
    const d = dbs.get(m.databaseId);
    return d ? { slug: d.slug, engine: d.engine } : null;
  }
  if (m.composeAppId) {
    const c = composeApps.get(m.composeAppId);
    return c ? { slug: c.slug } : null;
  }
  return null;
}

/** `actual`: every volume name on the daemon. Pure; unit-tested. */
export function orphanedVolumes(
  actual: string[],
  expected: Set<string>,
): string[] {
  return actual.filter(
    (name) => isCandidateVolume(name) && !expected.has(name),
  );
}
