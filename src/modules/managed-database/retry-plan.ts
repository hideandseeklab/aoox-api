import type { ManagedDatabase } from './managed-database.entity';

export const INTERRUPTED_MESSAGE =
  'Provisioning was interrupted by an API restart. Delete this database and create it again.';

/**
 * What `POST /databases/:id/reprovision` will do:
 *  - `fresh-volume`: the database never passed readiness and its history is
 *    tracked, so no user data can exist; the data volume (and the volumes of
 *    its mounts) are recreated. A half-initialised data directory (an engine
 *    killed during first init, the root user never created) cannot be repaired
 *    by starting again on it.
 *  - `reuse-volume`: the history is unknown (rows from before the tracking) or
 *    the database was ready once; the volume is kept, because it may hold data.
 * Null: not retryable (not in `error`, or interrupted by an API restart).
 */
export type RetryMode = 'fresh-volume' | 'reuse-volume';

export function retryModeFor(
  db: Pick<
    ManagedDatabase,
    'status' | 'errorMessage' | 'readyAt' | 'historyTracked'
  >,
): RetryMode | null {
  if (db.status !== 'error') return null;
  if (db.errorMessage === INTERRUPTED_MESSAGE) return null;
  if (db.historyTracked && !db.readyAt) return 'fresh-volume';
  return 'reuse-volume';
}
