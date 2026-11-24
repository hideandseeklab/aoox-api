import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import {
  composeLabels,
  DockerHandle,
  DockerService,
  OneShotTimeoutError,
} from '../docker/docker.service';
import {
  BACKUPS_MOUNT,
  BACKUPS_VOLUME,
} from '../database-backup/backups-volume';
import { APP_NETWORK } from '../proxy/proxy.service';
import { BackupDestination } from './backup-destination.entity';

/**
 * Transfers run in a one-off rclone container so
 * the file never streams through the API process. Pinned to the major so
 * S3 provider quirks stay stable.
 */
export const RCLONE_IMAGE = 'rclone/rclone:1';
/** rclone remote name; configured entirely through RCLONE_CONFIG_S3_* env. */
const REMOTE = 's3';

/** Public shape: everything but the secret key. */
export interface BackupDestinationDto {
  id: string;
  name: string;
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  forcePathStyle: boolean;
  createdAt: Date;
}

export interface DestinationConfig {
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * rclone reads `RCLONE_CONFIG_<REMOTE>_<KEY>` as if it were a config file
 * (https://rclone.org/docs/#config-file), so no file has to be written into
 * the helper. `provider=Other` covers MinIO/R2/Backblaze/…; AWS wants its own.
 */
export function rcloneEnv(c: DestinationConfig): string[] {
  return [
    `RCLONE_CONFIG_S3_TYPE=s3`,
    `RCLONE_CONFIG_S3_PROVIDER=${c.endpoint ? 'Other' : 'AWS'}`,
    `RCLONE_CONFIG_S3_ENV_AUTH=false`,
    `RCLONE_CONFIG_S3_ACCESS_KEY_ID=${c.accessKeyId}`,
    `RCLONE_CONFIG_S3_SECRET_ACCESS_KEY=${c.secretAccessKey}`,
    `RCLONE_CONFIG_S3_REGION=${c.region}`,
    `RCLONE_CONFIG_S3_ENDPOINT=${c.endpoint ?? ''}`,
    `RCLONE_CONFIG_S3_FORCE_PATH_STYLE=${c.forcePathStyle}`,
    // Never try to create the bucket: that needs extra permissions and hides typos.
    `RCLONE_CONFIG_S3_NO_CHECK_BUCKET=true`,
  ];
}

/**
 * Bounds for one rclone helper. rclone has no overall deadline: against an
 * endpoint that accepts nothing (a stack that was just deleted, a blackholed
 * address) it retries for many minutes, which used to hang `DELETE
 * /projects/:id?purge=true` for 16+ minutes.
 *  - `connectSeconds` (RCLONE_CONTIMEOUT) bounds each TCP connect;
 *  - `idleSeconds` (RCLONE_TIMEOUT) bounds a connection that stops moving
 *    data, NOT the total time, so a large upload keeps going while bytes flow;
 *  - one retry pass only for the short operations (a dead endpoint should
 *    fail fast), rclone's defaults (3 / 10) for transfers;
 *  - `capMs` is the hard wall-clock cap enforced on the container itself.
 */
export interface RcloneLimits {
  connectSeconds: number;
  idleSeconds: number;
  retries: number;
  lowLevelRetries: number;
  capMs: number;
}

export const RCLONE_LIMITS = {
  /** test, remove: answer quickly, never block a request. */
  quick: {
    connectSeconds: 10,
    idleSeconds: 20,
    retries: 1,
    lowLevelRetries: 1,
    capMs: 60_000,
  },
  /** purgeDir may delete many objects: longer cap, same stall detection. */
  purge: {
    connectSeconds: 10,
    idleSeconds: 30,
    retries: 1,
    lowLevelRetries: 2,
    capMs: 300_000,
  },
  /** backup upload/download: only stalls are bounded; 2 h backstop. */
  transfer: {
    connectSeconds: 15,
    idleSeconds: 60,
    retries: 3,
    lowLevelRetries: 5,
    capMs: 7_200_000,
  },
} satisfies Record<string, RcloneLimits>;

export function rcloneLimitEnv(l: RcloneLimits): string[] {
  return [
    `RCLONE_CONTIMEOUT=${l.connectSeconds}s`,
    `RCLONE_TIMEOUT=${l.idleSeconds}s`,
    `RCLONE_RETRIES=${l.retries}`,
    `RCLONE_LOW_LEVEL_RETRIES=${l.lowLevelRetries}`,
  ];
}

/** `s3:bucket/prefix/<key>` — the object key is `<prefix>/<filename>`. */
export function remoteKey(c: { prefix: string }, filename: string): string {
  const prefix = c.prefix.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${filename}` : filename;
}

@Injectable()
export class BackupDestinationService {
  private readonly logger = new Logger(BackupDestinationService.name);
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(BackupDestination)
    readonly repo: Repository<BackupDestination>,
    private readonly docker: DockerService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  toDto(d: BackupDestination): BackupDestinationDto {
    return {
      id: d.id,
      name: d.name,
      endpoint: d.endpoint,
      region: d.region,
      bucket: d.bucket,
      prefix: d.prefix,
      accessKeyId: d.accessKeyId,
      forcePathStyle: d.forcePathStyle,
      createdAt: d.createdAt,
    };
  }

  encryptSecret(secretAccessKey: string): string {
    return encryptSecret(secretAccessKey, this.encryptionKey);
  }

  async findOrFail(id: string): Promise<BackupDestination> {
    const d = await this.repo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Backup destination not found');
    return d;
  }

  /** Row plus decrypted config (internal use only). */
  async resolve(
    id: string,
  ): Promise<{ destination: BackupDestination; config: DestinationConfig }> {
    const destination = await this.repo
      .createQueryBuilder('d')
      .addSelect('d.secretAccessKeyEncrypted')
      .where('d.id = :id', { id })
      .getOne();
    if (!destination)
      throw new NotFoundException('Backup destination not found');
    return {
      destination,
      config: {
        endpoint: destination.endpoint,
        region: destination.region,
        bucket: destination.bucket,
        prefix: destination.prefix,
        accessKeyId: destination.accessKeyId,
        secretAccessKey: decryptSecret(
          destination.secretAccessKeyEncrypted,
          this.encryptionKey,
        ),
        forcePathStyle: destination.forcePathStyle,
      },
    };
  }

  /** Copies `filename` from the backups volume to the bucket; returns the object key. */
  async upload(
    id: string,
    filename: string,
    docker: DockerHandle = this.docker,
  ): Promise<string> {
    const { config } = await this.resolve(id);
    const key = remoteKey(config, filename);
    await this.rclone(
      config,
      [
        'copyto',
        `${BACKUPS_MOUNT}/${filename}`,
        `${REMOTE}:${config.bucket}/${key}`,
      ],
      [`${BACKUPS_VOLUME}:${BACKUPS_MOUNT}:ro`],
      docker,
      RCLONE_LIMITS.transfer,
    );
    return key;
  }

  /** Copies an object back into the backups volume (restore after the local file is gone). */
  async download(
    id: string,
    key: string,
    filename: string,
    docker: DockerHandle = this.docker,
  ): Promise<void> {
    const { config } = await this.resolve(id);
    await this.rclone(
      config,
      [
        'copyto',
        `${REMOTE}:${config.bucket}/${key}`,
        `${BACKUPS_MOUNT}/${filename}`,
      ],
      [`${BACKUPS_VOLUME}:${BACKUPS_MOUNT}`],
      docker,
      RCLONE_LIMITS.transfer,
    );
  }

  /**
   * Deletes one object; a missing object is not an error, and neither is a
   * destination that no longer works — prune/delete must not get stuck.
   */
  async remove(
    id: string,
    key: string,
    docker: DockerHandle = this.docker,
  ): Promise<boolean> {
    try {
      const { config } = await this.resolve(id);
      await this.rclone(
        config,
        ['deletefile', '--ignore-errors', `${REMOTE}:${config.bucket}/${key}`],
        [],
        docker,
        RCLONE_LIMITS.quick,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Remote delete of ${key} failed: ${String(err)}`);
      return false;
    }
  }

  /**
   * Recursively removes everything under `dir` (a full remote path, already
   * including the destination's own prefix — build it with `remoteKey()`).
   * A directory that doesn't exist is not an error, same spirit as `remove()`.
   */
  async purgeDir(
    id: string,
    dir: string,
    docker: DockerHandle = this.docker,
  ): Promise<void> {
    const { config } = await this.resolve(id);
    try {
      await this.rclone(
        config,
        ['purge', `${REMOTE}:${config.bucket}/${dir}`],
        [],
        docker,
        RCLONE_LIMITS.purge,
      );
    } catch (err) {
      if (!/directory not found/i.test(String(err))) throw err;
    }
  }

  /** Lists the prefix to prove credentials, endpoint and bucket are right. */
  async test(id: string): Promise<{ objects: number }> {
    const { config } = await this.resolve(id);
    const prefix = remoteKey(config, '');
    const output = await this.rclone(
      config,
      ['lsjson', '--max-depth', '1', `${REMOTE}:${config.bucket}/${prefix}`],
      [],
      this.docker,
      RCLONE_LIMITS.quick,
    );
    // Log lines carry a timestamp prefix; the (pretty-printed, multi-line)
    // JSON array starts at the first line that is just `[`.
    const lines = output
      .split('\n')
      .map((l) => l.replace(/^\S+Z\s+/, '').trim());
    const start = lines.findIndex((l) => l.startsWith('['));
    const json = start >= 0 ? lines.slice(start).join('') : '[]';
    const entries = JSON.parse(json) as unknown[];
    return { objects: entries.length };
  }

  private async rclone(
    config: DestinationConfig,
    args: string[],
    binds: string[] = [],
    docker: DockerHandle = this.docker,
    limits: RcloneLimits = RCLONE_LIMITS.quick,
  ): Promise<string> {
    await docker.ensureImage(RCLONE_IMAGE);
    // Same network as the databases so a self-hosted MinIO next to them
    // is reachable by container name; the internet is reachable either way.
    await docker.ensureNetwork(APP_NETWORK);
    let result: { code: number; output: string };
    try {
      result = await docker.runOnceWithOutput(
        {
          Image: RCLONE_IMAGE,
          Cmd: [...args, '--s3-upload-concurrency', '4', '--stats', '0'],
          Env: [...rcloneEnv(config), ...rcloneLimitEnv(limits)],
          Labels: composeLabels('backup-helper'),
          HostConfig: { NetworkMode: APP_NETWORK, Binds: binds },
        },
        limits.capMs,
      );
    } catch (err) {
      if (err instanceof OneShotTimeoutError) {
        throw new Error(
          `S3 did not answer within ${Math.round(limits.capMs / 1000)}s`,
        );
      }
      throw err;
    }
    const { code, output: raw } = result;
    // Error text ends up in the backup row and in notification channels;
    // never let the secret key travel with it (cf. DeploymentLog.redact).
    const output = raw.split(config.secretAccessKey).join('***');
    if (code !== 0) {
      throw new Error(
        // Drop rclone's own `2026/09/21 08:46:09 NOTICE: ` prefix.
        lastLine(output).replace(
          /^(\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d )?(ERROR|NOTICE|INFO)\s*:\s*/,
          '',
        ) || `rclone exit ${code}`,
      );
    }
    return output;
  }
}

function lastLine(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^\S+Z\s+/, '').trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}
