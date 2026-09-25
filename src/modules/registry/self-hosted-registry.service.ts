import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { composeLabels, DockerService } from '../docker/docker.service';

/** Names are fixed: there is exactly one self-hosted registry per install. */
export const REGISTRY_CONTAINER = 'aoox-registry';
export const REGISTRY_IMAGE = 'registry:3';
export const REGISTRY_DATA_VOLUME = 'aoox_registry_data';
export const REGISTRY_AUTH_VOLUME = 'aoox_registry_auth';
export const REGISTRY_USERNAME = 'aoox';

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
  async provision(): Promise<{ username: string; password: string }> {
    const password = randomBytes(24).toString('base64url');
    // Distribution only accepts bcrypt entries in htpasswd.
    const htpasswd = `${REGISTRY_USERNAME}:${await hash(password, 10)}\n`;

    await this.docker.ensureImage(REGISTRY_IMAGE);
    for (const name of [REGISTRY_DATA_VOLUME, REGISTRY_AUTH_VOLUME]) {
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

    const id = await this.docker.engine.createContainer(
      {
        Image: REGISTRY_IMAGE,
        Env: [
          'REGISTRY_AUTH=htpasswd',
          'REGISTRY_AUTH_HTPASSWD_REALM=aoox',
          'REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd',
          'REGISTRY_STORAGE_DELETE_ENABLED=true',
        ],
        Labels: {
          'aoox.component': 'registry',
          ...composeLabels('registry'),
        },
        ExposedPorts: { '5000/tcp': {} },
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          LogConfig: this.docker.logConfig,
          PortBindings: { '5000/tcp': [{ HostPort: String(this.port) }] },
          Binds: [
            `${REGISTRY_DATA_VOLUME}:/var/lib/registry`,
            `${REGISTRY_AUTH_VOLUME}:/auth:ro`,
          ],
        },
      },
      REGISTRY_CONTAINER,
    );
    await this.docker.engine.startContainer(id);
    this.logger.log(`Self-hosted registry started on ${this.publicUrl}`);
    return { username: REGISTRY_USERNAME, password };
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
}
