import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { EnvResolverService } from '../application/env-resolver.service';
import { Mount } from '../application/mount.entity';
import { filePath, prepareMounts, volumeNameFor } from '../application/mounts';
import { shellQuote, tarFiles } from '../application/nixpacks-builder.service';
import { DockerService } from '../docker/docker.service';
import { GitCredentialService } from '../git-credential/git-credential.service';
import { NotificationService } from '../notification/notification.service';
import { APP_NETWORK, ProxyService } from '../proxy/proxy.service';
import {
  ComposeApp,
  ComposeServiceDomain,
  ComposeServicePort,
  ComposeServiceResources,
} from './compose-app.entity';
import {
  ComposeDeployment,
  ComposeDeploymentTrigger,
} from './compose-deployment.entity';
import {
  ComposeService,
  composeProjectFor,
  composeVolumeFor,
} from './compose.service';

/** Official CLI image: docker + compose plugin + git, pinned to the engine major. */
export const COMPOSE_CLI_IMAGE = 'docker:29-cli';
const ENV_FILE = '.aoox.env';
/** Override file carrying the Traefik labels for `serviceDomains` and `ports:` for `servicePorts`. */
export const OVERRIDE_FILE = 'docker-compose.aoox.yml';
/** Runs kept per stack; older rows are pruned after every run. */
export const COMPOSE_RUN_KEEP = Number(process.env.COMPOSE_RUN_KEEP ?? 20);

/**
 * Paths inside the helper. The checkout volume is mounted at its own
 * daemon-side mountpoint (`/var/lib/docker/volumes/<name>/_data`), so the
 * relative bind mounts and build contexts compose resolves inside the helper
 * are paths the daemon can also open — otherwise `./nginx.conf:/etc/...`
 * would point at a directory that only exists in the helper.
 */
interface Paths {
  work: string;
  src: string;
}

export type ComposeAction = 'deploy' | 'stop' | 'start' | 'down';

/** Where a run came from; recorded on the ComposeDeployment row. */
export interface RunOptions {
  trigger?: ComposeDeploymentTrigger;
  /** Commit a webhook reported, for the history entry. */
  commitSha?: string | null;
  /** Row created by `queue()`; `run()` creates one itself when absent. */
  runId?: string;
}

/**
 * Runs `docker compose` for a stack inside a throwaway `docker:cli`
 * container that has the daemon socket and the app's checkout volume
 * mounted — Compose is a client-side tool with no Engine API, and the
 * official CLI can drive BuildKit for `build:` sections. The API already has
 * socket access, so the helper is not an escalation. Output streams into the
 * row (`logs`) while running; every action ends in a definite status.
 */
@Injectable()
export class ComposeRunnerService {
  private readonly logger = new Logger(ComposeRunnerService.name);
  private readonly active = new Set<string>();

  constructor(
    private readonly compose: ComposeService,
    private readonly docker: DockerService,
    private readonly credentials: GitCredentialService,
    private readonly envResolver: EnvResolverService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly proxy: ProxyService,
    @InjectRepository(ComposeDeployment)
    readonly runs: Repository<ComposeDeployment>,
    @InjectRepository(Mount)
    private readonly mountsRepo: Repository<Mount>,
  ) {}

  isActive(appId: string): boolean {
    return this.active.has(appId);
  }

  /** Fire-and-forget; the row's status/logs tell the story. */
  start(
    app: ComposeApp,
    action: ComposeAction,
    options: RunOptions = {},
  ): void {
    this.active.add(app.id);
    void this.run(app, action, options)
      .catch((err) =>
        this.logger.error(
          `compose ${action} ${app.slug} crashed: ${String(err)}`,
        ),
      )
      .finally(() => this.active.delete(app.id));
  }

  /**
   * Creates the run row first, then starts the helper, so the caller can
   * answer with the id to poll (`GET /compose-deployments/:id`).
   */
  async queue(
    app: ComposeApp,
    action: ComposeAction,
    options: RunOptions = {},
  ): Promise<ComposeDeployment> {
    const run = await this.newRun(app, action, options);
    this.start(app, action, { ...options, runId: run.id });
    return run;
  }

  async run(
    app: ComposeApp,
    action: ComposeAction,
    options: RunOptions = {},
  ): Promise<void> {
    const secrets: string[] = [];
    const paths = await this.paths(app);
    const run = options.runId
      ? await this.runs.findOneByOrFail({ id: options.runId })
      : await this.newRun(app, action, options);
    let log = '';
    let lastFlush = 0;
    const redact = (text: string) => {
      let out = text;
      for (const s of secrets) out = out.split(s).join('***');
      return out;
    };
    // Live output goes to the run row only; `ComposeApp.logs` is written
    // once at the end, so a chatty build does not double the write rate
    // (get-compose-app reads the running run's logs while it lasts).
    const flush = async () => {
      lastFlush = Date.now();
      await this.runs.update(run.id, { logs: log });
    };
    const append = (text: string) => {
      log += redact(text);
      if (Date.now() - lastFlush > 1000) void flush();
    };

    await this.compose.repo.update(app.id, {
      status: 'deploying',
      logs: '',
      errorMessage: null,
    });
    try {
      const { script, files } = await this.plan(app, action, secrets, paths);
      append(`==> compose ${action} (${composeProjectFor(app)})\n`);
      const code = await this.runHelper(app, paths, script, files, append);
      if (code !== 0)
        throw new Error(`docker compose exited with code ${code}`);

      const status: ComposeApp['status'] =
        action === 'stop' ? 'stopped' : action === 'down' ? 'idle' : 'running';
      append(`\n==> done\n`);
      log = redact(log);
      await this.finish(app, run.id, log, {
        status,
        errorMessage: null,
        ...(action === 'deploy' ? { deployedAt: new Date() } : {}),
      });
    } catch (err) {
      const message = redact(err instanceof Error ? err.message : String(err));
      append(`\nERROR: ${message}\n`);
      await this.finish(app, run.id, log, {
        status: 'error',
        errorMessage: message,
      });
      if (action === 'deploy') this.notifyFailure(app, message);
    }
  }

  /** One row per run: history that survives the next deploy's log overwrite. */
  private newRun(
    app: ComposeApp,
    action: ComposeAction,
    options: RunOptions,
  ): Promise<ComposeDeployment> {
    return this.runs.save(
      this.runs.create({
        composeAppId: app.id,
        action,
        trigger: options.trigger ?? 'manual',
        commitSha: options.commitSha ?? null,
        status: 'running',
        logs: '',
      }),
    );
  }

  /** Closes the run row, mirrors the output into the stack row, prunes. */
  private async finish(
    app: ComposeApp,
    runId: string,
    log: string,
    update: Partial<ComposeApp>,
  ): Promise<void> {
    await this.runs.update(runId, {
      logs: log,
      status: update.status === 'error' ? 'failed' : 'success',
      errorMessage: update.errorMessage ?? null,
      finishedAt: new Date(),
    });
    await this.compose.repo.update(app.id, { logs: log, ...update });
    await this.prune(app.id);
  }

  /**
   * Keeps the newest COMPOSE_RUN_KEEP finished rows of a stack. A run that
   * is still going is never a candidate: `queue()` creates the next row
   * before the previous run reaches `finish()`, so counting it could drop
   * the row whose logs are being written.
   */
  private async prune(composeAppId: string): Promise<void> {
    const old = await this.runs.find({
      where: { composeAppId, status: Not('running') },
      order: { startedAt: 'DESC' },
      select: { id: true },
      skip: COMPOSE_RUN_KEEP,
      take: 100,
    });
    if (old.length) await this.runs.delete(old.map((r) => r.id));
  }

  /** Builds the shell script and the files uploaded into the helper before it starts. */
  private async plan(
    app: ComposeApp,
    action: ComposeAction,
    secrets: string[],
    { work: WORK, src: SRC }: Paths,
  ): Promise<{ script: string; files: Array<[string, string]> }> {
    const project = composeProjectFor(app);
    // No --project-directory: relative paths (build contexts, volumes) resolve
    // against the compose file's own directory, as they would locally.
    // The override (when present) sits next to the compose file so both
    // resolve relative paths against the same directory.
    const composeDir = app.composePath.includes('/')
      ? `${SRC}/${shellQuote(app.composePath.replace(/\/[^/]*$/, ''))}`
      : SRC;
    // Only a deploy needs the mounts prepared (volumes created, file content
    // written) — stop/start/down reuse whatever override the last deploy
    // wrote, same as domains/ports.
    const mounts =
      action === 'deploy'
        ? await this.mountsRepo.find({
            where: { composeAppId: app.id },
            order: { createdAt: 'ASC' },
          })
        : [];
    const filesMountpoint =
      mounts.length > 0 ? await prepareMounts(this.docker, app, mounts) : null;
    const override = renderOverride(
      app.serviceDomains,
      app.servicePorts,
      mounts,
      app.serviceResources,
      (name, port, hosts) => this.proxy.labelsFor(name, port, hosts),
      app.slug,
      filesMountpoint,
      app.id,
    );
    const baseArgs = `-p ${shellQuote(project)} --env-file ${SRC}/${ENV_FILE} -f ${SRC}/${shellQuote(app.composePath)}`;
    const composeArgs =
      baseArgs + (override ? ` -f ${composeDir}/${OVERRIDE_FILE}` : '');
    const lines = ['set -e'];
    const files: Array<[string, string]> = [];

    if (action === 'deploy') {
      // The env file doubles as compose interpolation source (`${VAR}`).
      const resolved = await this.envResolver.resolve(
        app as unknown as Application,
      );
      secrets.push(...resolved.secrets);
      files.push([ENV_FILE, `${resolved.env.join('\n')}\n`]);
      if (app.source === 'template') {
        // No repository: the compose file lives in the row. Files are
        // uploaded to WORK before start and moved into the fresh SRC.
        files.push([app.composePath, app.composeContent ?? '']);
        lines.push(
          `rm -rf ${SRC} && mkdir -p ${SRC}`,
          `mv ${WORK}/${shellQuote(app.composePath)} ${SRC}/${shellQuote(app.composePath)}`,
        );
      } else {
        let remote = app.gitUrl ?? '';
        if (app.gitCredentialId) {
          const { username, token } = await this.credentials.resolve(
            app.gitCredentialId,
          );
          remote = GitCredentialService.authenticateUrl(
            remote,
            username,
            token,
          );
          secrets.push(token, encodeURIComponent(token));
        }
        lines.push(
          `rm -rf ${SRC} && git clone --quiet --depth 1 --branch ${shellQuote(app.gitBranch)} ${shellQuote(remote)} ${SRC} && rm -rf ${SRC}/.git`,
        );
      }
      lines.push(`mv ${WORK}/${ENV_FILE} ${SRC}/${ENV_FILE}`);
      if (override) {
        files.push([OVERRIDE_FILE, override]);
        lines.push(
          `mv ${WORK}/${OVERRIDE_FILE} ${composeDir}/${OVERRIDE_FILE}`,
        );
      }
      // No else: SRC was wiped above, so an override from an earlier deploy
      // is already gone and stop/start will not find one.
      //
      // `file` mounts need --force-recreate: their content lives on disk at
      // a path the override's bind entry does not change between deploys,
      // so compose's own diff sees no config change and leaves the running
      // container alone — but a file bind mount pins the container to the
      // inode that existed at mount time, so the *new* content silently
      // never reaches it without a recreate (confirmed against Docker:
      // editing the row and redeploying served the old content until this
      // flag was added). Volume/bind mounts don't have this problem — their
      // declared path is what changes, which compose already diffs on.
      const forceRecreate = mounts.some((m) => m.type === 'file')
        ? ' --force-recreate'
        : '';
      lines.push(
        `docker compose ${composeArgs} config --quiet`,
        `docker compose ${composeArgs} up -d --build --remove-orphans${forceRecreate}`,
      );
    } else {
      // Use whatever override the last deploy wrote (domains may have changed
      // in the row since), so the project config matches the running stack.
      const args = `${baseArgs} $OVERRIDE`;
      lines.push(
        `[ -f ${SRC}/${shellQuote(app.composePath)} ] || { echo "No checkout yet; deploy first"; exit 3; }`,
        `OVERRIDE=""; [ -f ${composeDir}/${OVERRIDE_FILE} ] && OVERRIDE="-f ${composeDir}/${OVERRIDE_FILE}"`,
      );
      if (action === 'stop') lines.push(`docker compose ${args} stop`);
      if (action === 'start') lines.push(`docker compose ${args} start`);
      if (action === 'down') {
        lines.push(`docker compose ${args} down --volumes --remove-orphans`);
      }
    }
    return { script: lines.join('\n'), files };
  }

  /** Creates the checkout volume and returns where it is mounted in the helper. */
  private async paths(app: ComposeApp): Promise<Paths> {
    await this.docker.engine.createVolume(composeVolumeFor(app));
    const { Mountpoint } = await this.docker.engine.inspectVolume(
      composeVolumeFor(app),
    );
    return { work: Mountpoint, src: `${Mountpoint}/src` };
  }

  private async runHelper(
    app: ComposeApp,
    { work: WORK }: Paths,
    script: string,
    files: Array<[string, string]>,
    onOutput: (text: string) => void,
  ): Promise<number> {
    await this.docker.ensureImage(COMPOSE_CLI_IMAGE);
    const id = await this.docker.engine.createContainer({
      Image: COMPOSE_CLI_IMAGE,
      Entrypoint: ['sh', '-c', script],
      Env: [
        'GIT_TERMINAL_PROMPT=0',
        `COMPOSE_PROJECT_NAME=${composeProjectFor(app)}`,
      ],
      Labels: { 'aoox.component': 'build' },
      HostConfig: {
        Binds: [
          `${this.docker.hostDockerSocket}:/var/run/docker.sock`,
          `${composeVolumeFor(app)}:${WORK}`,
        ],
        NetworkMode: 'bridge',
      },
    });
    try {
      if (files.length) {
        await this.docker.engine.putArchive(id, WORK, tarFiles(files));
      }
      await this.docker.engine.startContainer(id);
      const streamed = new Promise<void>((resolve) => {
        this.docker.engine.followContainerLogs(id, 10_000, onOutput, () =>
          resolve(),
        );
      });
      const code = await this.docker.engine.waitContainer(id);
      await Promise.race([streamed, new Promise((r) => setTimeout(r, 2000))]);
      return code;
    } finally {
      await this.docker.engine.removeContainer(id, true).catch(() => undefined);
    }
  }

  /** Removes stack, volumes and the checkout volume (used by delete). */
  async destroy(app: ComposeApp): Promise<void> {
    await this.run(app, 'down');
    await this.docker.engine
      .removeVolume(composeVolumeFor(app))
      .catch(() => undefined);
  }

  private notifyFailure(app: ComposeApp, error: string): void {
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    void this.notifications
      .broadcast('deploymentFailure', {
        title: `Compose deployment failed: ${app.name}`,
        level: 'failure',
        fields: [
          ['Stack', app.name],
          [
            'Source',
            app.source === 'template'
              ? `template ${app.templateId ?? ''}`
              : `${app.gitUrl}#${app.gitBranch}`,
          ],
          ['Error', error.slice(0, 500)],
        ],
        url: origin ? `${origin}/compose/${app.id}` : undefined,
        data: {
          event: 'compose.deployment.failure',
          composeAppId: app.id,
          stack: app.name,
          error,
        },
      })
      .catch((err) =>
        this.logger.warn(`Compose notification failed: ${String(err)}`),
      );
  }
}

interface OverrideVolumeEntry {
  type: 'volume' | 'bind';
  source: string;
  target: string;
  read_only?: boolean;
}

interface OverrideService {
  labels?: Record<string, string>;
  networks?: Record<string, object>;
  ports?: string[];
  volumes?: OverrideVolumeEntry[];
  deploy?: { resources: { limits: { cpus?: string; memory?: string } } };
}

interface OverrideVolumeDecl {
  external: true;
  name: string;
}

/** `deploy.resources.limits` fields for one service; omits a key that is unset. */
function resourceLimitFields(r: ComposeServiceResources): {
  cpus?: string;
  memory?: string;
} {
  const out: { cpus?: string; memory?: string } = {};
  if (r.cpuMillicores) out.cpus = (r.cpuMillicores / 1000).toString();
  if (r.memoryMb) out.memory = `${r.memoryMb}M`;
  return out;
}

/**
 * Compose override (JSON is valid YAML) for everything a stack service can
 * get beyond its own compose file: domains attach the platform's Traefik
 * labels and the `aoox` network (one router per service+port, named
 * `<slug>-<service>-<port>` — unique per stack, like `<appName>` for
 * applications); host ports add `ports: ["<host>:<container>"]` (compose
 * *appends* these to the base file's own, so an existing binding survives);
 * mounts add a `volumes:` entry in the long form (a short `host:container`
 * string cannot express a Windows-style or space-containing daemon path —
 * see `prepareMounts`/`bindsFor`, which face the same problem for plain
 * containers) plus a top-level `external: true` declaration for named
 * volumes (self-created — `prepareMounts` already made them, under our own
 * naming, so compose must not try to create its own); resource limits add
 * `deploy.resources.limits`, honoured by plain `docker compose up` since
 * Compose v2 (no swarm needed — verified against this project's own
 * `docker:29-cli`). Returns null when nothing is exposed.
 */
export function renderOverride(
  domains: ComposeServiceDomain[] | undefined,
  ports: ComposeServicePort[] | undefined,
  mounts: Mount[] | undefined,
  resources: ComposeServiceResources[] | undefined,
  labelsFor: (
    routerName: string,
    port: number,
    hosts: { host: string; https: boolean }[],
  ) => Record<string, string>,
  slug: string,
  filesMountpoint: string | null,
  /**
   * The stack's own id, stamped as `aoox.compose` on every service this
   * override touches, so `MetricRetentionService` can roll up its history
   * the same way it already does for applications/databases — no compose
   * file lookup needed, since we only ever know the services domains/ports/
   * mounts/resources name here anyway. A service with none of those set
   * gets no override entry at all, so it stays live-only (1h); a bare stack
   * (nothing configured on any service) still has no long-term history.
   */
  composeId: string,
): string | null {
  if (
    !domains?.length &&
    !ports?.length &&
    !mounts?.length &&
    !resources?.length
  ) {
    return null;
  }
  const groups = new Map<string, ComposeServiceDomain[]>();
  for (const d of domains ?? []) {
    const key = `${d.service}:${d.port}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const services: Record<string, OverrideService> = {};
  for (const list of groups.values()) {
    const { service, port } = list[0];
    const router = `${slug}-${service}-${port}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const entry = (services[service] ??= {});
    // Listing networks on a service drops the implicit `default` one, which
    // is how the stack's services find each other — so keep it explicitly.
    entry.networks ??= { default: {}, [APP_NETWORK]: {} };
    entry.labels = { ...entry.labels, ...labelsFor(router, port, list) };
  }
  for (const p of ports ?? []) {
    const entry = (services[p.service] ??= {});
    (entry.ports ??= []).push(`${p.hostPort}:${p.port}`);
  }
  const volumeDecls: Record<string, OverrideVolumeDecl> = {};
  for (const m of mounts ?? []) {
    if (!m.service) continue;
    const entry = (services[m.service] ??= {});
    if (m.type === 'volume') {
      const name = volumeNameFor({ slug }, m);
      // Keyed by service+name, not name alone: two services are free to use
      // the same mount name (e.g. both call it "data") and must still get
      // distinct volumes — a bare-name key would let the second declaration
      // silently overwrite the first's `external` mapping.
      const alias = `${m.service}_${m.name}`;
      volumeDecls[alias] = { external: true, name };
      (entry.volumes ??= []).push({
        type: 'volume',
        source: alias,
        target: m.containerPath,
        ...(m.readOnly ? { read_only: true } : {}),
      });
    } else if (m.type === 'bind') {
      (entry.volumes ??= []).push({
        type: 'bind',
        source: m.hostPath ?? '',
        target: m.containerPath,
        ...(m.readOnly ? { read_only: true } : {}),
      });
    } else if (m.type === 'file' && filesMountpoint) {
      (entry.volumes ??= []).push({
        type: 'bind',
        source: `${filesMountpoint}/${filePath(m)}`,
        target: m.containerPath,
        read_only: true,
      });
    }
  }
  for (const r of resources ?? []) {
    const limits = resourceLimitFields(r);
    if (!limits.cpus && !limits.memory) continue;
    const entry = (services[r.service] ??= {});
    entry.deploy = { resources: { limits } };
  }
  // Every service the override already touches (for any reason above) also
  // gets the ownership label, so its metrics roll up under this stack.
  for (const entry of Object.values(services)) {
    entry.labels = {
      ...entry.labels,
      'aoox.component': 'compose',
      'aoox.compose': composeId,
    };
  }
  const networks = domains?.length
    ? { [APP_NETWORK]: { external: true } }
    : undefined;
  const volumes = Object.keys(volumeDecls).length ? volumeDecls : undefined;
  return `${JSON.stringify({ services, networks, volumes }, null, 2)}\n`;
}
