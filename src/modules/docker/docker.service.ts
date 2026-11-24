import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContainerCreateBody,
  ContainerSummary,
  DockerEngineClient,
} from './docker-engine.client';
import { LogConfig, logConfig } from './log-config';

/**
 * Compose project name shared by every container aoox manages, so
 * Docker Desktop / `docker compose ls` show them as one group. The dev and
 * dist compose files use the same `name:`.
 */
export const COMPOSE_PROJECT = 'aoox';

/** Labels that make a container appear under the aoox compose group. */
export function composeLabels(service: string): Record<string, string> {
  return {
    'com.docker.compose.project': COMPOSE_PROJECT,
    'com.docker.compose.service': service,
    'com.docker.compose.oneoff': 'False',
  };
}

/** A one-shot helper container exceeded its wall-clock cap and was removed. */
export class OneShotTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`helper container did not finish within ${timeoutMs / 1000}s`);
    this.name = 'OneShotTimeoutError';
  }
}

/**
 * Helpers over one Docker engine — the local daemon (DockerService) or a
 * remote server's daemon reached over SSH (DockerHandle built by
 * RemoteDockerService). Everything that deploys/inspects containers takes
 * a handle, so the same code runs against either.
 */
export class DockerHandle {
  protected readonly logger = new Logger(DockerHandle.name);

  constructor(
    readonly engine: DockerEngineClient,
    /**
     * Daemon socket path on that engine's host, for bind-mounting into helper
     * containers (Traefik, compose CLI). On a remote server this is the
     * server's own socket.
     */
    readonly hostDockerSocket: string,
  ) {}

  async ping(): Promise<boolean> {
    try {
      return (await this.engine.ping()) === 'OK';
    } catch {
      return false;
    }
  }

  /** Creates the bridge network if missing (idempotent). */
  async ensureNetwork(name: string): Promise<void> {
    if (await this.engine.inspectNetwork(name)) return;
    await this.engine.createNetwork(name);
    this.logger.log(`Created network ${name} (${this.engine.target})`);
  }

  /** Pulls an image if it is not present locally. */
  async ensureImage(ref: string): Promise<void> {
    if (await this.engine.inspectImage(ref)) return;
    this.logger.log(`Pulling ${ref} (${this.engine.target})`);
    await this.engine.pullImage(ref);
  }

  /** Runs a throwaway container to completion, returning exit code and combined output. */
  async runOnceWithOutput(
    body: ContainerCreateBody,
    /**
     * Optional wall-clock cap. When it passes, the container is force-removed
     * (with its anonymous volumes) and `OneShotTimeoutError` is thrown.
     * Without it the call waits for the container as long as it runs.
     */
    timeoutMs?: number,
  ): Promise<{ code: number; output: string }> {
    const id = await this.engine.createContainer(body);
    try {
      await this.engine.startContainer(id);
      const code = await this.waitWithin(id, timeoutMs);
      const output = await this.engine.containerLogs(id, 200).catch(() => '');
      return { code, output };
    } finally {
      await this.engine.removeContainer(id, true, true).catch(() => undefined);
    }
  }

  private async waitWithin(id: string, timeoutMs?: number): Promise<number> {
    if (!timeoutMs) return this.engine.waitContainer(id);
    let timer: NodeJS.Timeout | undefined;
    const wait = this.engine.waitContainer(id);
    // The wait request is abandoned on timeout; its later failure (container
    // removed) must not become an unhandled rejection.
    wait.catch(() => undefined);
    try {
      return await Promise.race([
        wait,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new OneShotTimeoutError(timeoutMs)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Runs a throwaway container to completion and returns its exit code. */
  async runOnce(body: ContainerCreateBody): Promise<number> {
    const id = await this.engine.createContainer(body);
    try {
      await this.engine.startContainer(id);
      return await this.engine.waitContainer(id);
    } finally {
      await this.engine.removeContainer(id, true, true).catch(() => undefined);
    }
  }

  async findContainerByName(name: string): Promise<ContainerSummary | null> {
    const list = await this.engine.listContainers({ name: [name] });
    return list.find((c) => c.Names.includes(`/${name}`)) ?? null;
  }
}

/**
 * Access to the local Docker engine through our own Engine API client.
 * Connection is DOCKER_SOCKET (unix socket in Linux/containers, named pipe on
 * Windows dev). PROXY_DOCKER_SOCKET is the same daemon's socket as seen from
 * the host (differs when the API itself runs in Docker).
 */
@Injectable()
export class DockerService extends DockerHandle {
  /** Rotation applied to every long-running container we create (also on remote servers). */
  readonly logConfig: LogConfig | undefined;

  constructor(config: ConfigService) {
    const socketPath =
      config.get<string>('DOCKER_SOCKET') ??
      (process.platform === 'win32'
        ? '//./pipe/docker_engine'
        : '/var/run/docker.sock');
    super(
      new DockerEngineClient(socketPath),
      config.get<string>('PROXY_DOCKER_SOCKET') ?? '/var/run/docker.sock',
    );
    this.logConfig = logConfig({
      CONTAINER_LOG_MAX_SIZE: config.get<string>('CONTAINER_LOG_MAX_SIZE'),
      CONTAINER_LOG_MAX_FILE: config.get<string>('CONTAINER_LOG_MAX_FILE'),
    });
    this.logger.log(`Docker engine via ${socketPath}`);
  }
}
