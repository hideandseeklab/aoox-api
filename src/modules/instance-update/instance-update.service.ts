import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { parseImageRef } from '../application/image-reference';
import { DockerService } from '../docker/docker.service';
import { fetchRemoteDigest } from '../registry/remote-digest';
import {
  INSTANCE_UPDATE_STATE_ID,
  InstanceUpdateState,
} from './instance-update-state.entity';

const COMPOSE_CLI_IMAGE = 'docker:29-cli';
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
  api: ImageUpdateStatus;
  web: ImageUpdateStatus;
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
      })
    );
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
      currentVersion: this.currentVersion,
      installDirConfigured: this.installDir !== null,
      checkedAt: row.checkedAt,
      api,
      web,
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
      'docker compose -f docker-compose.dist.yml --env-file .env.dist pull',
      'docker compose -f docker-compose.dist.yml --env-file .env.dist up -d',
    ].join('\n');

    await this.docker.ensureImage(COMPOSE_CLI_IMAGE);
    const id = await this.docker.engine.createContainer({
      Image: COMPOSE_CLI_IMAGE,
      Entrypoint: ['sh', '-c', script],
      Labels: { 'aoox.component': 'build' },
      HostConfig: {
        Binds: [
          `${this.docker.hostDockerSocket}:/var/run/docker.sock`,
          `${installDir}:${installDir}`,
        ],
        NetworkMode: 'bridge',
      },
    });
    try {
      await this.docker.engine.startContainer(id);
      await this.docker.engine.waitContainer(id);
    } finally {
      await this.docker.engine.removeContainer(id, true).catch(() => undefined);
    }
  }
}
