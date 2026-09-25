import { Injectable } from '@nestjs/common';
import { BuildProgress } from '../docker/docker-engine.client';
import {
  composeLabels,
  DockerHandle,
  DockerService,
} from '../docker/docker.service';
import {
  NIXPACKS_HELPER_IMAGE,
  NixpacksBuilderService,
  shellQuote,
} from './nixpacks-builder.service';

/** Where the helper clones; the generated files go under `.aoox/`. */
const SRC = '/src';
const CONTEXT_TAR = '/context.tar';
export const NGINX_IMAGE = 'nginx:1.27-alpine';
/** Node major for the optional build stage; pinned so builds stay reproducible. */
export const DEFAULT_NODE_VERSION = '22';

export interface StaticSiteOptions {
  /** e.g. `npm ci && npm run build`; null = the repo already holds the files. */
  buildCommand: string | null;
  /** Folder with the final files, relative to the repo root (`dist`, `build`, `out`, `.`). */
  outputDir: string;
  /** Serve `index.html` for unknown paths (client-side routing). */
  spa: boolean;
  nodeVersion: string;
}

/**
 * Dockerfile for a static site: optional Node build stage, then nginx
 * serving the output folder on port 80. Pure so it can be unit-tested.
 */
export function renderStaticDockerfile(o: StaticSiteOptions): string {
  const out = o.outputDir.replace(/^\.\/+/, '').replace(/\/+$/, '') || '.';
  const lines: string[] = [];
  if (o.buildCommand) {
    lines.push(
      `FROM node:${o.nodeVersion}-alpine AS build`,
      'WORKDIR /src',
      'COPY . .',
      `RUN ${o.buildCommand}`,
      '',
      `FROM ${NGINX_IMAGE}`,
      `COPY --from=build /src/${out}/ /usr/share/nginx/html/`,
    );
  } else {
    lines.push(`FROM ${NGINX_IMAGE}`, `COPY ${out}/ /usr/share/nginx/html/`);
  }
  lines.push(
    'COPY .aoox/nginx.conf /etc/nginx/conf.d/default.conf',
    'EXPOSE 80',
  );
  return `${lines.join('\n')}\n`;
}

export function renderNginxConf(spa: boolean): string {
  return `server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  gzip on;
  gzip_types text/plain text/css application/json application/javascript image/svg+xml;
  location ~* \\.(?:js|css|woff2?|png|jpg|jpeg|gif|svg|ico)$ {
    expires 7d;
    add_header Cache-Control "public";
  }
  location / {
    try_files $uri $uri/ ${spa ? '/index.html' : '=404'};
  }
}
`;
}

export interface StaticBuildInput extends StaticSiteOptions {
  remote: string;
  branch: string;
  tag: string;
}

/**
 * Third build type beside Dockerfile and nixpacks: the helper image (git)
 * clones the repo, the generated Dockerfile + nginx.conf are dropped in
 * `.aoox/`, and the daemon builds the tarred tree — same pipeline as
 * nixpacks, minus the planner.
 */
@Injectable()
export class StaticSiteBuilderService {
  constructor(
    private readonly local: DockerService,
    private readonly nixpacks: NixpacksBuilderService,
  ) {}

  async build(
    input: StaticBuildInput,
    onLine: (msg: BuildProgress) => void,
    docker: DockerHandle = this.local,
  ): Promise<void> {
    await this.nixpacks.ensureHelperImage(onLine, docker);
    onLine({
      stream: `Cloning ${input.branch} for a static site (${input.buildCommand ? `build: ${input.buildCommand}, ` : ''}output: ${input.outputDir})\n`,
    });
    const script = [
      `git clone --quiet --depth 1 --branch ${shellQuote(input.branch)} ${shellQuote(input.remote)} ${SRC}`,
      `rm -rf ${SRC}/.git`,
      `mkdir -p ${SRC}/.aoox`,
      // The files come in through env so the script stays quote-free.
      `printf '%s' "$AOOX_DOCKERFILE" > ${SRC}/.aoox/Dockerfile`,
      `printf '%s' "$AOOX_NGINX" > ${SRC}/.aoox/nginx.conf`,
      `tar -C ${SRC} -cf ${CONTEXT_TAR} .`,
    ].join(' && ');
    const id = await docker.engine.createContainer({
      Image: NIXPACKS_HELPER_IMAGE,
      Entrypoint: ['sh', '-c', script],
      Env: [
        'GIT_TERMINAL_PROMPT=0',
        `AOOX_DOCKERFILE=${renderStaticDockerfile(input)}`,
        `AOOX_NGINX=${renderNginxConf(input.spa)}`,
      ],
      Labels: { 'aoox.component': 'build', ...composeLabels('static') },
      HostConfig: { NetworkMode: 'bridge' },
    });
    let context: Buffer;
    try {
      await docker.engine.startContainer(id);
      const code = await docker.engine.waitContainer(id);
      const output = await docker.engine.containerLogs(id, 200).catch(() => '');
      if (output)
        onLine({ stream: output.endsWith('\n') ? output : `${output}\n` });
      if (code !== 0) {
        throw new Error(`Could not clone the repository (exit ${code})`);
      }
      context = await docker.engine.readFileFromContainer(id, CONTEXT_TAR);
    } finally {
      await docker.engine.removeContainer(id, true).catch(() => undefined);
    }
    onLine({
      stream: `Building ${input.tag} with nginx (${Math.round(context.length / 1024)} KB context)\n`,
    });
    await docker.engine.buildFromTar(
      context,
      { tag: input.tag, dockerfile: '.aoox/Dockerfile' },
      onLine,
    );
  }
}
