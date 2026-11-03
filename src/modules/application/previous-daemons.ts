/**
 * Daemons that may still hold containers of an application after it was moved
 * to another server (`applications.previous_daemons`, jsonb string array).
 *
 * A move only changes `server_id`; it recreates nothing, so the app keeps
 * serving from the old daemon until a deploy (or runtime-config apply) has put
 * it on the new one. The old daemon is then recorded here and swept once the
 * new container is up. Entries are `'host'` (the aoox host's own daemon, which
 * is `server_id` NULL) or a server uuid. A list, not one value, so a chain of
 * moves before the first deploy (A to B to C) still remembers every daemon
 * that was ever left behind. There is deliberately no foreign key: a deleted
 * server simply has nothing left to clean.
 */
export const HOST_DAEMON = 'host';

export function daemonKey(serverId: string | null | undefined): string {
  return serverId || HOST_DAEMON;
}

export function serverIdOf(key: string): string | null {
  return key === HOST_DAEMON ? null : key;
}

/** The pending list after the app moved `from` -> `to` (the daemon it is on now is never pending). */
export function recordMove(
  pending: readonly string[] | null | undefined,
  from: string | null,
  to: string | null,
): string[] {
  const next = new Set(pending ?? []);
  next.add(daemonKey(from));
  next.delete(daemonKey(to));
  return [...next];
}

/** Pending daemons other than the one the app runs on. */
export function pendingDaemons(
  pending: readonly string[] | null | undefined,
  currentServerId: string | null,
): string[] {
  return (pending ?? []).filter((k) => k !== daemonKey(currentServerId));
}

/** The slice of a daemon handle the sweep needs. */
export interface SweepableDaemon {
  engine: {
    listContainers(
      filters?: Record<string, string[]>,
    ): Promise<{ Id: string; Labels?: Record<string, string> }[]>;
    removeContainer(id: string, force?: boolean): Promise<void>;
  };
}

/**
 * Removes every container that carries this application's `aoox.application`
 * label (the app container, `-next`, PR previews) from one daemon. Swarm tasks
 * are left to their service. Returns how many were removed; throws on a daemon error.
 */
export async function removeApplicationContainers(
  docker: SweepableDaemon,
  applicationId: string,
): Promise<number> {
  const found = await docker.engine.listContainers({
    label: [`aoox.application=${applicationId}`],
  });
  let removed = 0;
  for (const c of found) {
    if (c.Labels?.['com.docker.swarm.task']) continue;
    await docker.engine.removeContainer(c.Id, true);
    removed++;
  }
  return removed;
}
