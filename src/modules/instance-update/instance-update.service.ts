import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { parseImageRef } from '../application/image-reference';
import {
  COMPOSE_FILES_SCRIPT,
  runComposeHelper,
} from '../docker/compose-apply.util';
import { DockerService } from '../docker/docker.service';
import { fetchRemoteDigest } from '../registry/remote-digest';
import {
  INSTANCE_UPDATE_STATE_ID,
  InstanceUpdateState,
} from './instance-update-state.entity';

const DEFAULT_API_IMAGE = 'hideandseeklab/aoox-api:latest';
const DEFAULT_WEB_IMAGE = 'hideandseeklab/aoox-web:latest';

export interface ImageUpdateStatus {
  image: string;
  currentDigest: string | null;
  remoteDigest: string;
  updateAvailable: boolean;
}

export interface InstanceUpdateStatus {
  currentVersion: string;
  installDirConfigured: boolean;
  checkedAt: Date | null;
  /** True from `apply()` until this process's own version has changed. */
  applying: boolean;
  applyStartedAt: Date | null;
  api: ImageUpdateStatus;
  web: ImageUpdateStatus;
}

/** Cheap poll target for the web UI while an update is applying — no registry calls. */
export interface InstanceUpdateProgress {
  currentVersion: string;
  applying: boolean;
  applyStartedAt: Date | null;
}

/**
 * Checks whether newer `hideandseeklab/aoox-api`/`aoox-web` images have been
 * pushed for the tag this install tracks (`API_IMAGE`/`WEB_IMAGE` env,
 * default `:latest`), and applies the update via the same
 * `docker compose pull && up -d` an operator would run by hand — through a
 * helper container so the API doesn't need to survive its own restart to
 * finish the request (see panel-domain.service.ts for the same pattern).
 */
@Injectable()
export class InstanceUpdateService {
  private readonly logger = new Logger(InstanceUpdateService.name);

  constructor(
    @InjectRepository(InstanceUpdateState)
    private readonly repo: Repository<InstanceUpdateState>,
    private readonly docker: DockerService,
    private readonly config: ConfigService,
  ) {}

  get currentVersion(): string {
    try {
      const pkg = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
      ) as { version?: string };
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private get apiImage(): string {
    return this.config.get<string>('API_IMAGE') || DEFAULT_API_IMAGE;
  }

  private get webImage(): string {
    return this.config.get<string>('WEB_IMAGE') || DEFAULT_WEB_IMAGE;
  }

  private get installDir(): string | null {
    return this.config.get<string>('INSTALL_DIR')?.trim() || null;
  }

  private async state(): Promise<InstanceUpdateState> {
    const row = await this.repo.findOne({
      where: { id: INSTANCE_UPDATE_STATE_ID },
    });
    return (
      row ??
      this.repo.create({
        id: INSTANCE_UPDATE_STATE_ID,
        apiDigest: null,
        webDigest: null,
        checkedAt: null,
        applyStartedAt: null,
        applyFromVersion: null,
      })
    );
  }

  /** `Date.now() - process.uptime()*1000` — when this Node process itself started. */
  private get processBootedAt(): number {
    return Date.now() - process.uptime() * 1000;
  }

  /**
   * `applyStartedAt`/`applyFromVersion` mark "an update is being applied" —
   * cleared here (not by the restart itself, which this process has no
   * hook into) the first time a check happens to run on a process that is
   * either on a different `currentVersion` than when `apply()` was called,
   * or is simply a **newer process** than `applyStartedAt` (a `docker
   * compose up` recreate always starts a fresh process, even when a `:latest`
   * tag was republished under the same `package.json` version — e.g. a
   * hotfix, or a local `docker-compose.build.yml` build — in which case the
   * version alone would never change and the card would sit on "applying"
   * until the client's own timeout, despite the update having actually
   * worked). `BOOT_TOLERANCE_MS` only guards against clock-precision noise;
   * a real recreate takes far longer than that to pull and start. Mutates
   * `row` in place; caller is responsible for saving.
   */
  private clearApplyingIfDone(
    row: InstanceUpdateState,
    currentVersion: string,
  ): void {
    const BOOT_TOLERANCE_MS = 5000;
    if (row.applyStartedAt === null) return;
    const versionChanged =
      row.applyFromVersion !== null && row.applyFromVersion !== currentVersion;
    const isNewProcess =
      this.processBootedAt >= row.applyStartedAt.getTime() - BOOT_TOLERANCE_MS;
    if (versionChanged || isNewProcess) {
      row.applyStartedAt = null;
      row.applyFromVersion = null;
    }
  }

  private async remoteDigestFor(imageRef: string): Promise<string> {
    const ref = parseImageRef(imageRef);
    return fetchRemoteDigest(
      `https://${ref.registry}`,
      ref.repository,
      ref.tag,
    );
  }

  /**
   * `currentDigest: null` on the very first check ever run (no baseline yet)
   * — that check's digests become the baseline and `updateAvailable` reads
   * `false`, since there is nothing yet to compare against. From the next
   * check onward (or right after `apply()`) comparisons are meaningful.
   */
  async check(): Promise<InstanceUpdateStatus> {
    const row = await this.state();
    const currentVersion = this.currentVersion;
    this.clearApplyingIfDone(row, currentVersion);

    const [apiDigest, webDigest] = await Promise.all([
      this.remoteDigestFor(this.apiImage),
      this.remoteDigestFor(this.webImage),
    ]);

    const api: ImageUpdateStatus = {
      image: this.apiImage,
      currentDigest: row.apiDigest,
      remoteDigest: apiDigest,
      updateAvailable: row.apiDigest !== null && row.apiDigest !== apiDigest,
    };
    const web: ImageUpdateStatus = {
      image: this.webImage,
      currentDigest: row.webDigest,
      remoteDigest: webDigest,
      updateAvailable: row.webDigest !== null && row.webDigest !== webDigest,
    };

    if (row.apiDigest === null) row.apiDigest = apiDigest;
    if (row.webDigest === null) row.webDigest = webDigest;
    row.checkedAt = new Date();
    await this.repo.save(row);

    return {
      currentVersion,
      installDirConfigured: this.installDir !== null,
      checkedAt: row.checkedAt,
      applying: row.applyStartedAt !== null,
      applyStartedAt: row.applyStartedAt,
      api,
      web,
    };
  }

  /**
   * Poll target for the "applying update" UI: no registry HTTP calls (the
   * full `check()` fetches both remote digests every time, too heavy to hit
   * every few seconds for up to several minutes while polling for the
   * restart to finish).
   */
  async pingApplyStatus(): Promise<InstanceUpdateProgress> {
    const row = await this.state();
    const currentVersion = this.currentVersion;
    const wasApplying = row.applyStartedAt !== null;
    this.clearApplyingIfDone(row, currentVersion);
    if (wasApplying && row.applyStartedAt === null) {
      await this.repo.save(row);
    }
    return {
      currentVersion,
      applying: row.applyStartedAt !== null,
      applyStartedAt: row.applyStartedAt,
    };
  }

  /**
   * Pulls and restarts — recreates this very container (and web's), so the
   * actual `docker compose` run is fired detached after the HTTP response
   * has had time to flush, same as panel-domain's `apply()`.
   */
  async apply(): Promise<void> {
    const installDir = this.installDir;
    if (!installDir) {
      throw new BadRequestException(
        'INSTALL_DIR is not set — add INSTALL_DIR=<absolute path of the folder ' +
          'holding docker-compose.dist.yml on this host> to .env.dist and restart, ' +
          'then try again',
      );
    }

    const [apiDigest, webDigest] = await Promise.all([
      this.remoteDigestFor(this.apiImage),
      this.remoteDigestFor(this.webImage),
    ]);
    const row = await this.state();
    row.apiDigest = apiDigest;
    row.webDigest = webDigest;
    row.checkedAt = new Date();
    row.applyStartedAt = new Date();
    row.applyFromVersion = this.currentVersion;
    await this.repo.save(row);

    setTimeout(() => {
      this.runComposeUpdate(installDir).catch((err: unknown) => {
        this.logger.error(`Applying instance update failed: ${String(err)}`);
      });
    }, 1500);
  }

  private async runComposeUpdate(installDir: string): Promise<void> {
    const script = [
      'set -e',
      `cd ${installDir}`,
      ...COMPOSE_FILES_SCRIPT,
      'docker compose $FILES --env-file .env.dist pull',
      'docker compose $FILES --env-file .env.dist up -d',
    ].join('\n');

    await runComposeHelper(this.docker, installDir, script);
  }
}
