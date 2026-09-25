import { Injectable, Logger } from '@nestjs/common';
import { BuildProgress } from '../docker/docker-engine.client';
import {
  composeLabels,
  DockerHandle,
  DockerService,
} from '../docker/docker.service';

/** Nixpacks release pinned into the helper image (https://github.com/railwayapp/nixpacks/releases). */
export const NIXPACKS_VERSION = '1.41.0';
/** Local helper image: git + the nixpacks CLI; built once from HELPER_DOCKERFILE. */
export const NIXPACKS_HELPER_IMAGE = `aoox-nixpacks:${NIXPACKS_VERSION}`;
/** Where the helper clones the repo; nixpacks writes `.nixpacks/` next to the source. */
const SRC = '/src';
const CONTEXT_TAR = '/context.tar';

/**
 * The CLI is a static binary, so the helper only needs git and curl. Built
 * through the same `POST /build` (tar context) the app builds use, so the
 * API image itself stays free of nixpacks/docker binaries.
 */
export const HELPER_DOCKERFILE = `FROM debian:bookworm-slim
ARG NIXPACKS_VERSION=${NIXPACKS_VERSION}
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \\
 && rm -rf /var/lib/apt/lists/* \\
 && arch=$( [ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64 ) \\
 && curl -fsSL "https://github.com/railwayapp/nixpacks/releases/download/v\${NIXPACKS_VERSION}/nixpacks-v\${NIXPACKS_VERSION}-\${arch}-unknown-linux-musl.tar.gz" \\
    | tar xz -C /usr/local/bin nixpacks \\
 && nixpacks --version
`;

export interface NixpacksBuildInput {
  /** Clone URL, possibly with credentials embedded (never logged by us). */
  remote: string;
  branch: string;
  tag: string;
  /** Passed as `--env KEY=VALUE`: visible to nixpacks providers and the build. */
  buildArgs: Record<string, string>;
}

/**
 * Builds an image from a repository that has no Dockerfile, without host
 * binaries: a throwaway helper container clones the
 * repo and runs `nixpacks build --out` (plan only, no docker needed), the
 * API pulls the resulting source tree + `.nixpacks/Dockerfile` out as a tar
 * and hands it to the daemon's classic builder. `--no-cache` is required:
 * nixpacks' cache mounts are BuildKit-only syntax the Engine API build
 * endpoint cannot run without a BuildKit session.
 */
@Injectable()
export class NixpacksBuilderService {
  private readonly logger = new Logger(NixpacksBuilderService.name);

  constructor(private readonly local: DockerService) {}

  /** `docker` selects the daemon (remote server or local); helper image and containers live there. */
  async build(
    input: NixpacksBuildInput,
    onLine: (msg: BuildProgress) => void,
    docker: DockerHandle = this.local,
  ): Promise<void> {
    await this.ensureHelperImage(onLine, docker);

    onLine({
      stream: `Cloning ${input.branch} and generating the build plan with nixpacks ${NIXPACKS_VERSION}\n`,
    });
    const envFlags = Object.entries(input.buildArgs)
      .map(([k, v]) => `--env ${shellQuote(`${k}=${v}`)}`)
      .join(' ');
    // Credentials in the clone URL stay inside the helper; git is told not to prompt.
    const script = [
      `git clone --quiet --depth 1 --branch ${shellQuote(input.branch)} ${shellQuote(input.remote)} ${SRC}`,
      `rm -rf ${SRC}/.git`,
      `nixpacks build ${SRC} --out ${SRC} --name aoox --no-cache ${envFlags}`,
      `tar -C ${SRC} -cf ${CONTEXT_TAR} .`,
    ].join(' && ');

    const id = await docker.engine.createContainer({
      Image: NIXPACKS_HELPER_IMAGE,
      Entrypoint: ['sh', '-c', script],
      Env: ['GIT_TERMINAL_PROMPT=0'],
      Labels: {
        'aoox.component': 'build',
        ...composeLabels('nixpacks'),
      },
      HostConfig: { NetworkMode: 'bridge' },
    });
    let context: Buffer;
    try {
      await docker.engine.startContainer(id);
      const code = await docker.engine.waitContainer(id);
      const output = await docker.engine.containerLogs(id, 400).catch(() => '');
      if (output)
        onLine({ stream: output.endsWith('\n') ? output : `${output}\n` });
      if (code !== 0) {
        throw new Error(
          `nixpacks could not plan this repository (exit ${code}); see the log above`,
        );
      }
      context = await docker.engine.readFileFromContainer(id, CONTEXT_TAR);
    } finally {
      await docker.engine.removeContainer(id, true).catch(() => undefined);
    }

    onLine({
      stream: `Building ${input.tag} from the generated Dockerfile (${Math.round(context.length / 1024)} KB context)\n`,
    });
    await docker.engine.buildFromTar(
      context,
      {
        tag: input.tag,
        dockerfile: '.nixpacks/Dockerfile',
        buildArgs: input.buildArgs,
      },
      onLine,
    );
  }

  /** Builds the helper image once per nixpacks version (no-op afterwards). */
  async ensureHelperImage(
    onLine: (msg: BuildProgress) => void,
    docker: DockerHandle = this.local,
  ): Promise<void> {
    if (await docker.engine.inspectImage(NIXPACKS_HELPER_IMAGE)) return;
    onLine({
      stream: `Preparing the nixpacks helper image ${NIXPACKS_HELPER_IMAGE} (first use)\n`,
    });
    this.logger.log(
      `Building ${NIXPACKS_HELPER_IMAGE} on ${docker.engine.target}`,
    );
    await docker.engine.buildFromTar(
      tarSingleFile('Dockerfile', HELPER_DOCKERFILE),
      { tag: NIXPACKS_HELPER_IMAGE },
      onLine,
    );
  }
}

/** POSIX single-quote escaping for values embedded in `sh -c`. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Minimal ustar archive holding one regular file (for the helper Dockerfile). */
export function tarSingleFile(name: string, content: string): Buffer {
  return tarFiles([[name, content]]);
}

/** Minimal ustar archive of several regular files at the root. */
export function tarFiles(
  files: Array<[name: string, content: string | Buffer]>,
): Buffer {
  return Buffer.concat([
    ...files.map(([name, content]) => tarEntry(name, content)),
    Buffer.alloc(1024, 0),
  ]);
}

function tarEntry(name: string, content: string | Buffer): Buffer {
  const data = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(
    `${data.length.toString(8).padStart(11, '0')}\0`,
    124,
    12,
    'utf8',
  );
  header.write(
    `${Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0')}\0`,
    136,
    12,
    'utf8',
  );
  header.write('        ', 148, 8, 'utf8'); // checksum placeholder (spaces)
  header.write('0', 156, 1, 'utf8'); // regular file
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
}
