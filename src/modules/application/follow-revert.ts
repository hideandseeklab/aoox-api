import type { Repository } from 'typeorm';
import type { Application } from './application.entity';

/**
 * What the auto-follow watcher changed when it moved an application to a newer
 * tag, so a failed deployment can put it back.
 */
export interface FollowRevert {
  /** The reference the watcher switched to. */
  followedRef: string;
  /** The reference (and digest baseline) the application had before. */
  previousRef: string;
  previousDigest: string | null;
}

/**
 * After a follow deployment failed: `imageRef` goes back to the previous
 * reference, so a later manual redeploy does not pull the broken tag again.
 * Writes only the two columns the watcher itself changed, and only while
 * `imageRef` is still the followed reference: a user who changed it in the
 * meantime wins. `autoUpdateLastTag` is left alone (the no-retry guard).
 * Returns whether anything was reverted.
 */
export async function revertFollowedTag(
  repo: Pick<Repository<Application>, 'update'>,
  applicationId: string,
  revert: FollowRevert,
): Promise<boolean> {
  const res = await repo.update(
    { id: applicationId, imageRef: revert.followedRef },
    { imageRef: revert.previousRef, imageDigest: revert.previousDigest },
  );
  return !!res.affected;
}
