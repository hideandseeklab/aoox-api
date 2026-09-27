import { tarFiles } from '../application/nixpacks-builder.service';
import { DockerService } from './docker.service';

const COMPOSE_CLI_IMAGE = 'docker:29-cli';

/** `sh` line that sets KEY=value in .env.dist, replacing any existing line for KEY. */
export function envUpsertLine(key: string, value: string): string {
  const escaped = value.replace(/[\\&/]/g, '\\$&');
  return (
    `grep -q '^${key}=' .env.dist ` +
    `&& sed -i "s/^${key}=.*/${key}=${escaped}/" .env.dist ` +
    `|| echo '${key}=${value}' >> .env.dist`
  );
}

/**
 * `sh` lines that build a `$FILES` variable for `docker compose $FILES ...`.
 * Compose only auto-includes `docker-compose.override.yml` when the base
 * file is named exactly `docker-compose.yml` — with `-f docker-compose.dist.yml`
 * given explicitly (as this stack always does), the override (written by the
 * panel-domain feature; may not exist yet) must be listed explicitly too, or
 * whatever it configures (a custom panel domain) is silently dropped on the
 * next `up`.
 */
export const COMPOSE_FILES_SCRIPT = [
  'FILES="-f docker-compose.dist.yml"',
  '[ -f docker-compose.override.yml ] && FILES="$FILES -f docker-compose.override.yml"',
];

/**
 * Runs `script` inside a throwaway `docker:29-cli` container with
 * `installDir` bind-mounted at the same host path (so relative paths inside
 * compose files resolve the same way on the daemon side) plus the docker
 * socket, optionally writing `files` into `installDir` first (e.g.
 * `docker-compose.override.yml`). Shared by every feature that edits
 * `.env.dist`/compose files and re-runs `docker compose` from inside the
 * panel's own container (panel-domain, instance-update, instance-env).
 */
export async function runComposeHelper(
  docker: DockerService,
  installDir: string,
  script: string,
  files: [name: string, content: string][] = [],
): Promise<void> {
  await docker.ensureImage(COMPOSE_CLI_IMAGE);
  const id = await docker.engine.createContainer({
    Image: COMPOSE_CLI_IMAGE,
    Entrypoint: ['sh', '-c', script],
    Labels: { 'aoox.component': 'build' },
    HostConfig: {
      Binds: [
        `${docker.hostDockerSocket}:/var/run/docker.sock`,
        `${installDir}:${installDir}`,
      ],
      NetworkMode: 'bridge',
    },
  });
  try {
    if (files.length > 0) {
      await docker.engine.putArchive(id, installDir, tarFiles(files));
    }
    await docker.engine.startContainer(id);
    await docker.engine.waitContainer(id);
  } finally {
    await docker.engine.removeContainer(id, true).catch(() => undefined);
  }
}
