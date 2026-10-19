import { ConflictException } from '@nestjs/common';

/**
 * A new database is `creating` until its engine answers (see
 * `ManagedDatabaseService.waitUntilReady`). Anything that stops, restarts or
 * recreates its container in that window can break the first-boot init (a
 * half-initialised data directory is never repaired), so those routes answer
 * 409 until it is `running`.
 */
export function assertNotStarting(db: { status: string }): void {
  if (db.status === 'creating') {
    throw new ConflictException(
      'The database is still starting. Try again in a moment.',
    );
  }
}
