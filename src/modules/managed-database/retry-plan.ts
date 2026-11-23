import type { ManagedDatabase } from './managed-database.entity';

export const INTERRUPTED_MESSAGE =
  'Provisioning was interrupted by an API restart. Delete this database and create it again.';

/**
 * Prefix of the message of a failed restore step. A database created by
 * "restore a backup into a new database" whose provisioning or restore failed Retrying would only start an empty (or half restored) engine
 * and report `running`, hiding the failure, so it is not retryable: delete it
 * and restore again.
 */
export const RESTORE_FAILED_PREFIX = 'Restore of backup ';

/** Message of a failed restore step: `Restore of backup <file> failed: <reason>`. */
export function restoreFailedMessage(filename: string, reason: string): string {
  return `${RESTORE_FAILED_PREFIX}${filename} failed: ${reason}`;
}

/**
 * What `POST /databases/:id/reprovision` will do:
 *  - `fresh-volume`: the database never passed readiness and its history is
 *    tracked, so no user data can exist; the data volume (and the volumes of
 *    its mounts) are recreated. A half-initialised data directory (an engine
 *    killed during first init, the root user never created) cannot be repaired
 *    by starting again on it.
 *  - `reuse-volume`: the history is unknown (rows from before the tracking) or
 *    the database was ready once; the volume is kept, because it may hold data.
 * Null: not retryable (not in `error`, interrupted by an API restart, or a failed restore into a new database).
 */
export type RetryMode = 'fresh-volume' | 'reuse-volume';

export function retryModeFor(
  db: Pick<
    ManagedDatabase,
    'status' | 'errorMessage' | 'readyAt' | 'historyTracked' | 'restorePending'
  >,
): RetryMode | null {
  if (db.status !== 'error') return null;
  if (db.errorMessage === INTERRUPTED_MESSAGE) return null;
  if (db.restorePending) return null;
  if (db.historyTracked && !db.readyAt) return 'fresh-volume';
  return 'reuse-volume';
}
