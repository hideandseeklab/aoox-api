import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { In } from 'typeorm';
import { newerImageTag, parseSemver } from '../registry/semver';
import { ApplicationService } from './application.service';
import { Application } from './application.entity';
import { DeployApplicationService } from './deploy-application/deploy-application.service';
import { ImageDigestService } from './image-digest.service';
import { parseImageRef, withTag } from './image-reference';

export interface ImageCheckResult {
  /** Tag of the image reference that was checked (`0.1.0-alpha.2`, `latest`). */
  tag: string;
  /** Digest the registry serves now for that tag (null when the reference pins a digest). */
  remoteDigest: string | null;
  /** Digest deployed before this check. */
  previousDigest: string | null;
  changed: boolean;
  /** Set when a deployment was queued. */
  deploymentId: string | null;
  /** First check for this app: digest recorded, nothing deployed. */
  baseline: boolean;
  /**
   * Newest higher version tag in the repository when `tag` is a semver tag
   * (null: none, tag is not semver, or the lookup failed — see `tagError`).
   */
  newerTag: string | null;
  /** The image reference with `newerTag` in place of the current tag. */
  newerImageRef: string | null;
  /** Short reason when the tag listing failed (never fails the check itself). */
  tagError: string | null;
  /** Set when the watcher moved the application to a newer tag (auto-follow). */
  switchedTo: string | null;
}

/**
 * Watchtower-style auto-update for image-sourced apps: every minute, apps
 * with `autoUpdate` whose interval elapsed get their tag's digest compared
 * with the deployed one; a change queues a normal deployment (which pulls
 * and replaces the container with the usual health check / blue-green).
 * With `autoUpdateFollowTags` the repository's tags are listed first and the
 * app moves to the newest compatible version tag (same major, 0.x: same
 * minor) before the digest comparison.
 */
@Injectable()
export class ImageUpdateWatcherService {
  private readonly logger = new Logger(ImageUpdateWatcherService.name);
  private running = false;

  constructor(
    private readonly applications: ApplicationService,
    private readonly digests: ImageDigestService,
    private readonly deploy: DeployApplicationService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const apps = await this.applications.repo.find({
        where: { sourceType: 'image', autoUpdate: true, status: 'running' },
      });
      const now = Date.now();
      for (const app of apps) {
        const due =
          !app.imageCheckedAt ||
          now - app.imageCheckedAt.getTime() >=
            app.autoUpdateIntervalMinutes * 60_000;
        if (!due) continue;
        try {
          const r = await this.check(app, true, {
            follow: app.autoUpdateFollowTags,
          });
          if (r.switchedTo) {
            this.logger.log(
              `Image of ${app.name} moved to tag ${r.switchedTo}; deployment ${r.deploymentId} queued`,
            );
          } else if (r.deploymentId) {
            this.logger.log(
              `Image of ${app.name} changed (${r.remoteDigest?.slice(7, 19)}); deployment ${r.deploymentId} queued`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Image check for ${app.name} failed: ${String(err)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * One check; `deploy` = queue a deployment when the digest changed. A
   * check that fails (registry down) still stamps `imageCheckedAt` so one
   * broken registry cannot make every tick retry it. `follow` (the watcher
   * only, never a manual check) lets the check move the app to a newer
   * compatible version tag.
   */
  async check(
    app: Application,
    deploy: boolean,
    opts: { follow?: boolean } = {},
  ): Promise<ImageCheckResult> {
    const previousDigest = app.imageDigest;
    app.imageCheckedAt = new Date();
    const parsed = app.imageRef ? parseImageRef(app.imageRef) : null;
    const tag = parsed?.tag ?? '';
    const lookupTags = !!parsed && !parsed.digest && !!parseSemver(tag);

    // Tags first: auto-follow decides before the digest of the old tag matters.
    let newerTag: string | null = null;
    let tagError: string | null = null;
    let compatibleTag: string | null = null;
    if (lookupTags) {
      try {
        const tags = await this.digests.remoteTags(app);
        newerTag = newerImageTag(tags, tag);
        if (opts.follow) {
          compatibleTag = newerImageTag(tags, tag, { compatibleOnly: true });
          // A tag the watcher already tried (and that did not stick) is not tried again.
          if (compatibleTag && compatibleTag === app.autoUpdateLastTag) {
            compatibleTag = null;
          }
        }
      } catch (err) {
        tagError = shortError(err);
      }
    }
    const newerImageRef =
      newerTag && app.imageRef ? withTag(app.imageRef, newerTag) : null;
    const tagInfo = { tag, newerTag, newerImageRef, tagError };

    if (deploy && opts.follow && compatibleTag && app.imageRef) {
      const queued = await this.followTag(app, compatibleTag);
      if (queued !== null) {
        return {
          ...tagInfo,
          remoteDigest: null,
          previousDigest,
          changed: true,
          deploymentId: queued,
          baseline: false,
          switchedTo: compatibleTag,
        };
      }
      // A deployment is running: skip this round, the next tick tries again.
      await this.applications.repo.update(app.id, {
        imageCheckedAt: app.imageCheckedAt,
      });
      return {
        ...tagInfo,
        remoteDigest: null,
        previousDigest,
        changed: false,
        deploymentId: null,
        baseline: false,
        switchedTo: null,
      };
    }

    let remoteDigest: string | null;
    try {
      remoteDigest = await this.digests.remoteDigest(app);
    } catch (err) {
      await this.applications.repo.update(app.id, {
        imageCheckedAt: app.imageCheckedAt,
      });
      throw err;
    }
    const baseline = !previousDigest && !!remoteDigest;
    const changed =
      !!remoteDigest && !!previousDigest && remoteDigest !== previousDigest;
    let deploymentId: string | null = null;
    if (baseline || (changed && !deploy)) {
      // A baseline is recorded without deploying; a manual check only reports.
      await this.applications.repo.update(app.id, {
        imageCheckedAt: app.imageCheckedAt,
        ...(baseline ? { imageDigest: remoteDigest } : {}),
      });
      if (baseline) app.imageDigest = remoteDigest;
    } else {
      await this.applications.repo.update(app.id, {
        imageCheckedAt: app.imageCheckedAt,
      });
    }
    if (changed && deploy) {
      try {
        const d = await this.deploy.queue(app, 'auto-update');
        deploymentId = d.id;
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
        // A deployment is already running; the next tick compares again.
      }
    }
    return {
      ...tagInfo,
      remoteDigest,
      previousDigest,
      changed,
      deploymentId,
      baseline,
      switchedTo: null,
    };
  }

  /**
   * Moves the application to `newTag` and queues a deployment. Writes only its
   * own columns (`repo.update`, never `save`: a PATCH may run meanwhile) and
   * only when `imageRef` is still what was read, so a concurrent settings
   * change wins. `autoUpdateLastTag` remembers the attempt so a failed or
   * reverted tag is never retried; when the deployment fails the runner puts
   * `imageRef` back (`revertFollowedTag`). Returns the deployment id, or null when a
   * deployment is active or the settings changed meanwhile (nothing changed).
   */
  private async followTag(
    app: Application,
    newTag: string,
  ): Promise<string | null> {
    const active = await this.applications.deployments.count({
      where: {
        applicationId: app.id,
        status: In(['queued', 'building', 'pushing', 'starting']),
      },
    });
    if (active > 0) return null;
    const oldRef = app.imageRef as string;
    const oldTag = parseImageRef(oldRef).tag;
    const newRef = withTag(oldRef, newTag);
    const oldDigest = app.imageDigest;
    const res = await this.applications.repo.update(
      { id: app.id, imageRef: oldRef },
      {
        imageRef: newRef,
        imageDigest: null,
        autoUpdateLastTag: newTag,
        imageCheckedAt: app.imageCheckedAt,
      },
    );
    if (!res.affected) return null;
    // The runner pulls the reference of the copy it is handed.
    app.imageRef = newRef;
    app.imageDigest = null;
    app.autoUpdateLastTag = newTag;
    try {
      const d = await this.deploy.queue(app, 'auto-update', {
        trigger: 'auto-update',
        commitMessage: `to ${newTag} (was ${oldTag})`,
        // A failed deployment puts the previous reference back (see revertFollowedTag).
        followRevert: {
          followedRef: newRef,
          previousRef: oldRef,
          previousDigest: oldDigest,
        },
      });
      return d.id;
    } catch (err) {
      // Lost a race for the deployment slot: put the reference back.
      await this.applications.repo.update(
        { id: app.id, imageRef: newRef },
        { imageRef: oldRef, imageDigest: null },
      );
      app.imageRef = oldRef;
      if (err instanceof ConflictException) return null;
      throw err;
    }
  }
}

/** One short line for the UI; the registry client's messages carry no credentials or URLs. */
function shortError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 160 ? `${msg.slice(0, 157)}...` : msg;
}
