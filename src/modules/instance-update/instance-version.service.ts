import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { hostname } from 'os';
import { Repository } from 'typeorm';
import { parseImageRef } from '../application/image-reference';
import { DockerService } from '../docker/docker.service';
import { appVersion } from '../auth/me/app-version';
import { fetchRemoteTags } from '../registry/remote-tags';
import {
  INSTANCE_UPDATE_STATE_ID,
  InstanceUpdateState,
} from './instance-update-state.entity';
import { isNewer, newestVersion, parseSemver } from './semver';

const DEFAULT_API_IMAGE = 'hideandseeklab/aoox-api:latest';
/** Longest a started update still counts as "in progress" for the badge. */
const APPLYING_WINDOW_MS = 10 * 60_000;

/**
 * `latest` = the install follows the moving `:latest` tag, so "a newer
 * version was published" really means `pull` would bring it; `pinned` = an
 * explicit tag (exact version or channel) that `pull` never moves; `unknown`
 * = the tag could not be determined. Only `latest` may show an update badge.
 */
export type TagTracking = 'latest' | 'pinned' | 'unknown';

export interface InstanceVersionInfo {
  currentVersion: string;
  tracking: TagTracking;
  /** Tag of the image the panel was started from, when known. */
  trackedTag: string | null;
  latestVersion: string | null;
  latestCheckedAt: Date | null;
  /** Derived on read: newer published version AND the tag is followed. */
  updateAvailable: boolean;
  /** An update was started recently (bounded, so a failed apply cannot pin this forever). */
  applying: boolean;
}

/**
 * Keeps a cached "newest published aoox version" (cron + once after boot,
 * never per request) and answers "is an update available?" from that cache —
 * what the dashboard sidebar badge is built on. Network/registry failures are
 * swallowed at debug level: an install without internet access behaves
 * exactly as before, just without a badge.
 */
@Injectable()
export class InstanceVersionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InstanceVersionService.name);
  private tagPromise: Promise<{
    tracking: TagTracking;
    tag: string | null;
  }> | null = null;

  constructor(
    @InjectRepository(InstanceUpdateState)
    private readonly repo: Repository<InstanceUpdateState>,
    private readonly docker: DockerService,
    private readonly config: ConfigService,
  ) {}

  get currentVersion(): string {
    return appVersion();
  }

  /** Base URL of the registry to query; overridable for mirrors/tests. */
  private registryBase(registry: string): string {
    return (
      this.config.get<string>('INSTANCE_UPDATE_REGISTRY_URL')?.trim() ||
      `https://${registry}`
    );
  }

  onApplicationBootstrap(): void {
    // Not right at boot: the API is busy starting, and a fleet of installs
    // restarting together (an update) should not hit the registry in lockstep.
    this.later(20_000 + Math.random() * 40_000);
  }

  @Cron('17 */6 * * *')
  scheduled(): void {
    this.later(Math.random() * 5 * 60_000);
  }

  private later(ms: number): void {
    setTimeout(() => void this.refresh(), ms).unref();
  }

  /**
   * How this install follows the image: the `API_IMAGE` env if the container
   * happens to have it (the stock compose file does not pass it on), else the
   * image reference the running container was created from — read once from
   * the daemon, it cannot change during this process's life. Anything that
   * cannot be read is `unknown` and never yields a badge.
   */
  tracked(): Promise<{ tracking: TagTracking; tag: string | null }> {
    this.tagPromise ??= this.detectTag();
    return this.tagPromise;
  }

  private async detectTag(): Promise<{
    tracking: TagTracking;
    tag: string | null;
  }> {
    let ref = this.config.get<string>('API_IMAGE')?.trim() || null;
    if (!ref) {
      try {
        const own = await this.docker.engine.inspectContainer(hostname());
        ref = own?.Config.Image ?? null;
      } catch {
        ref = null;
      }
    }
    if (!ref) return { tracking: 'unknown', tag: null };
    const parsed = parseImageRef(ref);
    if (parsed.digest) return { tracking: 'pinned', tag: parsed.digest };
    return {
      tracking: parsed.tag === 'latest' ? 'latest' : 'pinned',
      tag: parsed.tag,
    };
  }

  /**
   * One registry lookup; stores the newest published version. Returns
   * whether it succeeded. Never throws.
   */
  async refresh(): Promise<boolean> {
    try {
      const ref = parseImageRef(
        this.config.get<string>('API_IMAGE')?.trim() || DEFAULT_API_IMAGE,
      );
      const tags = await fetchRemoteTags(
        this.registryBase(ref.registry),
        ref.repository,
      );
      const latest = newestVersion(tags, this.currentVersion);
      // Keep the previous value when the registry lists no usable tag.
      if (latest === null) return true;
      await this.repo.upsert(
        {
          id: INSTANCE_UPDATE_STATE_ID,
          latestVersion: latest,
          latestCheckedAt: new Date(),
        },
        ['id'],
      );
      return true;
    } catch (err) {
      this.logger.debug(`Version check skipped: ${String(err)}`);
      return false;
    }
  }

  async info(): Promise<InstanceVersionInfo> {
    const [row, { tracking, tag }] = await Promise.all([
      this.repo.findOne({ where: { id: INSTANCE_UPDATE_STATE_ID } }),
      this.tracked(),
    ]);
    const currentVersion = this.currentVersion;
    const latestVersion = row?.latestVersion ?? null;
    return {
      currentVersion,
      tracking,
      trackedTag: tag,
      latestVersion,
      latestCheckedAt: row?.latestCheckedAt ?? null,
      applying:
        !!row?.applyStartedAt &&
        Date.now() - row.applyStartedAt.getTime() < APPLYING_WINDOW_MS,
      updateAvailable:
        tracking === 'latest' &&
        latestVersion !== null &&
        parseSemver(currentVersion) !== null &&
        isNewer(latestVersion, currentVersion),
    };
  }
}
