import { ContainerSummary } from '../docker/docker-engine.client';

export interface HostPortAppRow {
  id: string;
  appName: string;
  hostPort: number;
}

export interface HostPortDbRow {
  name: string;
  hostPort: number;
}

export interface HostPortStackRow {
  id: string;
  name: string;
  servicePorts: { hostPort: number }[];
}

export interface HostPortConflictData {
  apps: HostPortAppRow[];
  dbs: HostPortDbRow[];
  stacks: HostPortStackRow[];
  containers: ContainerSummary[];
}

export interface HostPortConflictOptions {
  /** The application's own row, so an unchanged port does not collide with itself. */
  excludeApplicationId?: string;
  /** The compose stack's own row, ditto. */
  excludeComposeAppId?: string;
  /** A container the caller already knows is this app/stack's own — it is
   * recreated on deploy, so its current binding does not count. */
  isOwnContainer?: (container: ContainerSummary) => boolean;
}

/**
 * Docker only reports a bind conflict at container-start time — by then the
 * old container may already be gone, so the service is down. Pure so both
 * the "platform table" side (applications/managed_databases/compose stacks)
 * and the "daemon" side (currently bound container ports) can be checked
 * up front. Returns one human-readable string per conflicting port; empty
 * means free.
 */
export function hostPortConflicts(
  ports: number[],
  data: HostPortConflictData,
  options: HostPortConflictOptions = {},
): string[] {
  const seen = new Set(ports);
  if (seen.size === 0) return [];
  // A Set: dedupe the daemon's separate IPv4/IPv6 entries for one binding.
  const taken = new Set<string>();
  for (const a of data.apps) {
    if (a.id === options.excludeApplicationId) continue;
    if (seen.has(a.hostPort))
      taken.add(`${a.hostPort} (aplikasi ${a.appName})`);
  }
  for (const d of data.dbs) {
    if (seen.has(d.hostPort)) taken.add(`${d.hostPort} (database ${d.name})`);
  }
  for (const s of data.stacks) {
    if (s.id === options.excludeComposeAppId) continue;
    for (const p of s.servicePorts) {
      if (seen.has(p.hostPort)) taken.add(`${p.hostPort} (stack ${s.name})`);
    }
  }
  for (const c of data.containers) {
    if (options.isOwnContainer?.(c)) continue;
    const name = c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12);
    for (const p of c.Ports ?? []) {
      if (p.PublicPort && seen.has(p.PublicPort)) {
        taken.add(`${p.PublicPort} (container ${name})`);
      }
    }
  }
  return [...taken];
}
