import { InstanceVersionInfo } from './instance-version.service';

export interface ApplyGuardInput {
  tracking: InstanceVersionInfo['tracking'];
  /** Tag (or digest) the running container was created from, when known. */
  trackedTag: string | null;
  /** Tag the update check compares (from `API_IMAGE`, default `latest`). */
  checkedTag: string;
  /** Newest published version, for the message only. */
  latestVersion: string | null;
  /**
   * Whether the registry digest of the tag this install follows differs from
   * the baseline taken for that SAME reference (either image).
   */
  digestChanged: boolean;
}

/**
 * Why an update cannot be applied, or null when it can.
 *
 * `docker compose pull` never moves a pinned tag, so applying on a pinned
 * install only does something when the registry's digest for that very tag
 * changed (a republished tag). Everything else (a newer version under another
 * tag, no baseline yet for this reference, a check that does not look at the
 * tag the container runs) would report success without changing the version.
 * `latest` and `unknown` installs are never blocked here.
 */
export function applyBlockReason(input: ApplyGuardInput): string | null {
  if (input.tracking !== 'pinned') return null;
  const tagMatches =
    input.trackedTag !== null && input.trackedTag === input.checkedTag;
  if (tagMatches && input.digestChanged) return null;
  const tag = input.trackedTag ?? 'a fixed tag';
  const latest = input.latestVersion
    ? ` (latest published version: ${input.latestVersion})`
    : '';
  return (
    `This install is pinned to ${tag}, so pulling it again would not change the version${latest}. ` +
    'To upgrade, set API_IMAGE and WEB_IMAGE in .env.dist to the new tag (or remove both lines to follow latest), then run `sudo aoox reinstall`.'
  );
}
