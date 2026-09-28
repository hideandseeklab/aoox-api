import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { DestinationConfig } from '../backup-destination/backup-destination.service';
import { composeLabels, DockerService } from '../docker/docker.service';
import { APP_NETWORK } from '../proxy/proxy.service';
import { registryS3Env } from './registry-s3-env';

/** Names are fixed: there is exactly one self-hosted registry per install. */
export const REGISTRY_CONTAINER = 'aoox-registry';
export const REGISTRY_IMAGE = 'registry:3';
export const REGISTRY_DATA_VOLUME = 'aoox_registry_data';
export const REGISTRY_AUTH_VOLUME = 'aoox_registry_auth';
export const REGISTRY_USERNAME = 'aoox';
const HELPER_IMAGE = 'busybox:stable';

export interface SelfHostedStatus {
  installed: boolean;
  running: boolean;
  state: string | null;
  containerId: string | null;
  image: string | null;
}

/** Runs the official `registry` (OCI Distribution) image on the local Docker engine. */
@Injectable()
export class SelfHostedRegistryService {
  private readonly logger = new Logger(SelfHostedRegistryService.name);

  constructor(
    private readonly docker: DockerService,
    private readonly config: ConfigService,
  ) {}

  get port(): number {
    return Number(this.config.get<string>('REGISTRY_PORT') ?? 5000);
  }

  /** Host[:port] clients use for `docker push`; localhost is exempt from the insecure-registry rule. */
  get publicUrl(): string {
    const host = this.config.get<string>('REGISTRY_PUBLIC_HOST') ?? 'localhost';
    return `${host}:${this.port}`;
  }

  async status(): Promise<SelfHostedStatus> {
    const c = await this.docker.findContainerByName(REGISTRY_CONTAINER);
    if (!c) {
      return {
        installed: false,
        running: false,
        state: null,
        containerId: null,
        image: null,
      };
    }
    return {
      installed: true,
      running: c.State === 'running',
      state: c.State,
      containerId: c.Id,
      image: c.Image,
    };
  }

  /** Creates volumes, writes the htpasswd file, starts the container. Returns the generated password. */
  async provision(
    destination: DestinationConfig | null = null,
  ): Promise<{ username: string; password: string }> {
    const password = randomBytes(24).toString('base64url');
    // Distribution only accepts bcrypt entries in htpasswd.
    const htpasswd = `${REGISTRY_USERNAME}:${await hash(password, 10)}\n`;

    await this.docker.ensureImage(REGISTRY_IMAGE);
    // Auth is always local, even with S3 storage — htpasswd isn't "registry data".
    const volumes = destination
      ? [REGISTRY_AUTH_VOLUME]
      : [REGISTRY_DATA_VOLUME, REGISTRY_AUTH_VOLUME];
    for (const name of volumes) {
      await this.docker.engine.createVolume(name);
    }

    // Write /auth/htpasswd into the auth volume via a throwaway container, so
    // this works whether the API runs on the host or inside Docker.
    const code = await this.docker.runOnce({
      Image: REGISTRY_IMAGE,
      Entrypoint: ['sh', '-c', 'printf "%s" "$HTPASSWD" > /auth/htpasswd'],
      Env: [`HTPASSWD=${htpasswd}`],
      HostConfig: { Binds: [`${REGISTRY_AUTH_VOLUME}:/auth`] },
    });
    if (code !== 0) throw new Error(`writing htpasswd failed (exit ${code})`);

    await this.createContainer({}, destination);
    this.logger.log(
      `Self-hosted registry started on ${this.publicUrl}` +
        (destination ? ` (S3: ${destination.bucket})` : ''),
    );
    return { username: REGISTRY_USERNAME, password };
  }

  /**
   * Recreates the container with (or without) Traefik labels for a custom
   * domain — same idea as an application's domain change (recreate, no
   * rebuild). Volumes and the htpasswd file are untouched, so credentials and
   * pushed images survive. Caller updates `Registry.domain`/`url` afterward.
   * `destination` must be passed again (whatever the registry already uses —
   * storage backend never changes here, only labels do).
   */
  async setDomain(
    labels: Record<string, string>,
    destination: DestinationConfig | null,
  ): Promise<void> {
    const c = await this.docker.findContainerByName(REGISTRY_CONTAINER);
    if (!c) throw new Error('Self-hosted registry is not provisioned');
    await this.docker.engine.removeContainer(c.Id, true);
    await this.createContainer(labels, destination);
  }

  /** Joins the `aoox` network (for Traefik) and publishes the host port either way. */
  private async createContainer(
    extraLabels: Record<string, string>,
    destination: DestinationConfig | null,
  ): Promise<void> {
    await this.docker.ensureNetwork(APP_NETWORK);
    const id = await this.docker.engine.createContainer(
      {
        Image: REGISTRY_IMAGE,
        Env: [
          'REGISTRY_AUTH=htpasswd',
          'REGISTRY_AUTH_HTPASSWD_REALM=aoox',
          'REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd',
          'REGISTRY_STORAGE_DELETE_ENABLED=true',
          ...(destination ? registryS3Env(destination) : []),
        ],
        Labels: {
          'aoox.component': 'registry',
          ...composeLabels('registry'),
          ...extraLabels,
        },
        ExposedPorts: { '5000/tcp': {} },
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          LogConfig: this.docker.logConfig,
          NetworkMode: APP_NETWORK,
          PortBindings: { '5000/tcp': [{ HostPort: String(this.port) }] },
          Binds: [
            ...(destination
              ? []
              : [`${REGISTRY_DATA_VOLUME}:/var/lib/registry`]),
            `${REGISTRY_AUTH_VOLUME}:/auth:ro`,
          ],
        },
      },
      REGISTRY_CONTAINER,
    );
    await this.docker.engine.startContainer(id);
  }

  /** Stops and removes the container; volumes are kept unless `purge`. */
  async remove(purge: boolean): Promise<void> {
    const c = await this.docker.findContainerByName(REGISTRY_CONTAINER);
    if (c) await this.docker.engine.removeContainer(c.Id, true);
    if (purge) {
      for (const name of [REGISTRY_DATA_VOLUME, REGISTRY_AUTH_VOLUME]) {
        await this.docker.engine.removeVolume(name).catch(() => undefined);
      }
    }
  }

  /** `registry garbage-collect` inside the running container; returns its output. */
  async garbageCollect(dryRun: boolean): Promise<string> {
    const c = await this.docker.findContainerByName(REGISTRY_CONTAINER);
    if (!c || c.State !== 'running') {
      throw new Error('Self-hosted registry is not running');
    }
    return this.docker.engine.exec(c.Id, {
      Cmd: [
        'registry',
        'garbage-collect',
        '--delete-untagged',
        ...(dryRun ? ['--dry-run'] : []),
        '/etc/distribution/config.yml',
      ],
    });
  }

  /**
   * Removes a repository's folder from local disk storage — the `_catalog`
   * registry:3 reports is just `docker/registry/v2/repositories/*` on disk,
   * and neither the Distribution API nor garbage-collect ever deletes that
   * folder itself, only the blobs/manifests inside other repos' folders they
   * still reference. No-op for S3-backed registries; use
   * `BackupDestinationService.purgeDir()` there instead (see AGENTS.md
   * "Docker & Registry"). `repository` must already be validated by
   * `assertValidRepositoryName` — passed as a `Cmd` argument (no shell), so
   * there is no injection risk here even so.
   */
  async removeRepositoryData(repository: string): Promise<void> {
    await this.docker.ensureImage(HELPER_IMAGE);
    const code = await this.docker.runOnce({
      Image: HELPER_IMAGE,
      Cmd: [
        'rm',
        '-rf',
        `/var/lib/registry/docker/registry/v2/repositories/${repository}`,
      ],
      HostConfig: { Binds: [`${REGISTRY_DATA_VOLUME}:/var/lib/registry`] },
    });
    if (code !== 0) {
      throw new Error(`removing repository data failed (exit ${code})`);
    }
  }

  /**
   * Restarts the registry container. registry:3's default config keeps an
   * in-memory blob-descriptor cache (`storage.cache.blobdescriptor:
   * inmemory` — on by default, nothing in `createContainer()` turns it off);
   * after garbage-collect deletes blobs, that cache can still believe they
   * exist, so a subsequent `docker push` of the same layer sees "blob
   * already exists" and skips re-uploading it — the manifest ends up
   * pointing at a blob that is no longer on disk, and `docker pull` then
   * fails. Restarting clears the cache (it is per-process, not persisted)
   * without touching data; used after the GC that follows a repository
   * delete, when blobs are actually removed.
   */
  async restartRegistry(): Promise<void> {
    const c = await this.docker.findContainerByName(REGISTRY_CONTAINER);
    if (!c) return;
    await this.docker.engine.restartContainer(c.Id);
  }
}
