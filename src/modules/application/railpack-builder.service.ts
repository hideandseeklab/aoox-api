import { Injectable, Logger } from '@nestjs/common';
import { BuildProgress } from '../docker/docker-engine.client';
import { composeLabels, DockerService } from '../docker/docker.service';
import { tarSingleFile } from './nixpacks-builder.service';

/** Pinned like NIXPACKS_VERSION; bumping it rebuilds the helper image. */
export const RAILPACK_VERSION = process.env.RAILPACK_VERSION ?? '0.39.0';
/** BuildKit daemon railpack talks to (its own container, not the docker daemon). */
export const BUILDKIT_VERSION = process.env.BUILDKIT_VERSION ?? 'v0.27.0';

export const RAILPACK_HELPER_IMAGE = `aoox-railpack:${RAILPACK_VERSION}`;
export const BUILDKIT_CONTAINER = 'aoox-buildkit';
export const BUILDKIT_VOLUME = 'aoox_buildkit';
const BUILDKIT_IMAGE = `moby/buildkit:${BUILDKIT_VERSION}`;
const SRC = '/src';

/**
 * Helper = docker CLI (railpack drives BuildKit through `docker-container://`)
 * + git + the railpack binary. Built through `POST /build` like the nixpacks
 * helper, so the API image stays free of build tooling.
 */
export const RAILPACK_HELPER_DOCKERFILE = `FROM docker:29-cli
ARG RAILPACK_VERSION=${RAILPACK_VERSION}
RUN apk add --no-cache git curl ca-certificates \\
 && arch=$(uname -m) \\
 && curl -fsSL "https://github.com/railwayapp/railpack/releases/download/v\${RAILPACK_VERSION}/railpack-v\${RAILPACK_VERSION}-\${arch}-unknown-linux-musl.tar.gz" \\
    | tar xz -C /usr/local/bin railpack \\
 && railpack --version
`;

export interface RailpackBuildInput {
  /** Clone URL, possibly with credentials embedded (never logged by us). */
  remote: string;
  branch: string;
  /** Image name railpack writes into the daemon, e.g. `localhost:5000/p/app:tag`. */
  tag: string;
  /** `--env KEY=VALUE`: seen by railpack's providers and by the build itself. */
  buildArgs: Record<string, string>;
  /** Prefix for BuildKit's cache keys so apps do not share layers by accident. */
  cacheKey: string;
}

/** Shell command the helper runs; pure so the test can read it. */
export function railpackScript(input: RailpackBuildInput): string {
  const envFlags = Object.entries(input.buildArgs)
    .map(([k, v]) => `--env ${shellQuote(`${k}=${v}`)}`)
    .join(' ');
  return [
    `git clone --quiet --depth 1 --branch ${shellQuote(input.branch)} ${shellQuote(input.remote)} ${SRC}`,
    `rm -rf ${SRC}/.git`,
    [
      `railpack build ${SRC}`,
      `--name ${shellQuote(input.tag)}`,
      `--cache-key ${shellQuote(input.cacheKey)}`,
      '--progress plain',
      envFlags,
    ]
      .filter(Boolean)
      .join(' '),
  ].join(' && ');
}

/**
 * Third build type beside Dockerfile and nixpacks: Railway's Railpack, which
 * compiles a repository into a BuildKit build plan. Unlike nixpacks this
 * **keeps its cache between deploys** — the plan is executed by a long-lived
 * `moby/buildkit` container (own volume), so dependency layers survive.
 * Host daemon only: the BuildKit container lives next to the registry, and a
 * per-server BuildKit is out of scope (see the runner's guard).
 */
@Injectable()
export class RailpackBuilderService {
  private readonly logger = new Logger(RailpackBuilderService.name);

  constructor(private readonly docker: DockerService) {}

  async build(
    input: RailpackBuildInput,
    onLine: (msg: BuildProgress) => void,
  ): Promise<void> {
    await this.ensureHelperImage(onLine);
    await this.ensureBuildkit(onLine);

    onLine({
      stream: `Cloning ${input.branch} and building with railpack ${RAILPACK_VERSION} (BuildKit cache: ${input.cacheKey})\n`,
    });
    const id = await this.docker.engine.createContainer({
      Image: RAILPACK_HELPER_IMAGE,
      Entrypoint: ['sh', '-c', railpackScript(input)],
      Env: [
        'GIT_TERMINAL_PROMPT=0',
        `BUILDKIT_HOST=docker-container://${BUILDKIT_CONTAINER}`,
      ],
      Labels: { 'aoox.component': 'build', ...composeLabels('railpack') },
      HostConfig: {
        // The helper execs into the BuildKit container through the daemon,
        // and the built image is loaded into that same daemon.
        Binds: [`${this.docker.hostDockerSocket}:/var/run/docker.sock`],
        NetworkMode: 'bridge',
      },
    });
    try {
      await this.docker.engine.startContainer(id);
      const finished = this.docker.engine.waitContainer(id);
      // Railpack prints BuildKit's progress; stream it like a docker build.
      const stop = this.docker.engine.followContainerLogs(
        id,
        0,
        (text) => onLine({ stream: text }),
        () => undefined,
      );
      const code = await finished;
      stop();
      if (code !== 0) {
        throw new Error(
          `railpack could not build this repository (exit ${code}); see the log above`,
        );
      }
    } finally {
      await this.docker.engine.removeContainer(id, true).catch(() => undefined);
    }
  }

  /** Builds the helper image once per railpack version (no-op afterwards). */
  async ensureHelperImage(onLine: (msg: BuildProgress) => void): Promise<void> {
    if (await this.docker.engine.inspectImage(RAILPACK_HELPER_IMAGE)) return;
    onLine({
      stream: `Preparing the railpack helper image ${RAILPACK_HELPER_IMAGE} (first use)\n`,
    });
    await this.docker.engine.buildFromTar(
      tarSingleFile('Dockerfile', RAILPACK_HELPER_DOCKERFILE),
      { tag: RAILPACK_HELPER_IMAGE },
      onLine,
    );
  }

  /**
   * Starts the shared BuildKit daemon if it is not running. It is
   * long-lived on purpose — its volume *is* the build cache — and labelled
   * `component=build` so monitoring and the container-down notifier ignore it.
   */
  async ensureBuildkit(onLine?: (msg: BuildProgress) => void): Promise<void> {
    const existing = await this.docker.findContainerByName(BUILDKIT_CONTAINER);
    if (existing?.State === 'running') return;
    if (existing) {
      await this.docker.engine.startContainer(existing.Id);
      return;
    }
    onLine?.({
      stream: `Starting the shared BuildKit daemon ${BUILDKIT_IMAGE} (cache volume ${BUILDKIT_VOLUME})\n`,
    });
    await this.docker.ensureImage(BUILDKIT_IMAGE);
    await this.docker.engine.createVolume(BUILDKIT_VOLUME);
    const id = await this.docker.engine.createContainer(
      {
        Image: BUILDKIT_IMAGE,
        Labels: {
          'aoox.component': 'build',
          ...composeLabels('buildkit'),
        },
        HostConfig: {
          // BuildKit needs its own namespaces for the workers it spawns.
          Privileged: true,
          RestartPolicy: { Name: 'unless-stopped' },
          LogConfig: this.docker.logConfig,
          Binds: [`${BUILDKIT_VOLUME}:/var/lib/buildkit`],
        },
      },
      BUILDKIT_CONTAINER,
    );
    await this.docker.engine.startContainer(id);
    this.logger.log(`BuildKit started (${BUILDKIT_IMAGE})`);
  }

  /** Trims the build cache; the daemon's own prune does not reach this volume. */
  async pruneCache(keepBytes: number): Promise<string> {
    const c = await this.docker.findContainerByName(BUILDKIT_CONTAINER);
    if (!c || c.State !== 'running') return '';
    const { output } = await this.docker.engine.execWithCode(c.Id, {
      Cmd: ['buildctl', 'prune', '--keep-storage', String(keepBytes)],
      AttachStdout: true,
      AttachStderr: true,
    });
    return output;
  }
}

/** POSIX single-quote escaping for values embedded in `sh -c`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
