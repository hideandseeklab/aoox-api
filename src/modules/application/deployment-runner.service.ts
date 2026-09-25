import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { In } from 'typeorm';
import { BuildProgress, RegistryAuth } from '../docker/docker-engine.client';
import {
  composeLabels,
  DockerHandle,
  DockerService,
} from '../docker/docker.service';
import { resourceLimits } from '../docker/resource-limits';
import { HEALTHCHECK_WAIT_MS, healthcheckFor } from './healthcheck';
import { bindsFor, prepareMounts } from './mounts';
import { GitCredentialService } from '../git-credential/git-credential.service';
import {
  APP_NETWORK,
  ProxyService,
  SWARM_NETWORK,
} from '../proxy/proxy.service';
import { Registry } from '../registry/registry.entity';
import { RegistryService } from '../registry/registry.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { ImageDigestService } from './image-digest.service';
import { SwarmDeployService } from './swarm-deploy.service';
import { SwarmService } from '../swarm/swarm.service';
import { serviceSpecFor } from './service-spec';
import { proxySettingsOf } from '../server/server.entity';
import { ServerService } from '../server/server.service';
import { Application, ApplicationStatus } from './application.entity';
import { ApplicationService, containerNameFor } from './application.service';
import { Deployment, DeploymentStatus } from './deployment.entity';
import { DeploymentEventsService } from './deployment-events.service';
import { EnvResolverService, parseEnvLines } from './env-resolver.service';
import { NixpacksBuilderService } from './nixpacks-builder.service';
import { RailpackBuilderService } from './railpack-builder.service';
import {
  DEFAULT_NODE_VERSION,
  StaticSiteBuilderService,
} from './static-site-builder.service';

/**
 * Executes a deployment end to end, detached from the HTTP request that
 * queued it: build (daemon clones the git repo) -> push to the self-hosted
 * registry -> replace the running container. Progress and logs are written
 * to the Deployment row so the UI can poll it.
 */
@Injectable()
export class DeploymentRunnerService {
  private readonly logger = new Logger(DeploymentRunnerService.name);

  constructor(
    private readonly docker: DockerService,
    private readonly registries: RegistryService,
    private readonly applications: ApplicationService,
    private readonly events: DeploymentEventsService,
    private readonly credentials: GitCredentialService,
    private readonly proxy: ProxyService,
    private readonly envResolver: EnvResolverService,
    private readonly nixpacks: NixpacksBuilderService,
    private readonly railpack: RailpackBuilderService,
    private readonly staticSite: StaticSiteBuilderService,
    private readonly remote: RemoteDockerService,
    private readonly digests: ImageDigestService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly swarm: SwarmService,
    private readonly servers: ServerService,
  ) {}

  /** Fire-and-forget; every path ends in `success` or `failed`. */
  start(deployment: Deployment, app: Application): void {
    void this.run(deployment, app).catch((err) =>
      this.logger.error(`Deployment ${deployment.id} crashed: ${String(err)}`),
    );
  }

  private async run(deployment: Deployment, app: Application): Promise<void> {
    const log = new DeploymentLog(deployment, this.applications, this.events);
    try {
      if (deployment.kind === 'rollback' || deployment.kind === 'config') {
        await this.rollback(deployment, app, log);
        return;
      }

      let imageRef: string;
      if (app.sourceType === 'image') {
        imageRef = await this.pullSourceImage(app, log);
        // Baseline for the auto-update watcher: the registry's digest of what we just pulled.
        app.imageDigest = await this.digests
          .remoteDigest(app)
          .catch(() => null);
        app.imageCheckedAt = new Date();
      } else {
        const { docker, registry } = await this.buildTargets(app);
        imageRef = await this.buildImage(app, app.gitBranch, {
          tag: deployment.id.slice(0, 12),
          docker,
          registry,
          log,
        });
      }
      deployment.imageRef = imageRef;

      await log.step('starting', `Starting container ${containerNameFor(app)}`);
      await this.replaceContainer(app, imageRef, log);

      app.status = 'running';
      app.currentImage = imageRef;
      await this.applications.repo.save(app);
      await log.finish('success', `Deployed ${imageRef}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A failed build/push leaves the previous container untouched, so only
      // mark the app as errored when the container itself was replaced.
      if (deployment.status === 'starting') {
        app.status = await this.statusAfterFailure(app);
        await this.applications.repo.save(app).catch(() => undefined);
      }
      await log.finish('failed', `ERROR: ${message}`, message);
    }
  }

  /**
   * `image` source: no build, no push — the target daemon pulls the
   * reference (with the chosen registry's credentials for private images).
   * Rollback still works: earlier deployments keep the ref they ran.
   */
  private async pullSourceImage(
    app: Application,
    log: BuildLog,
  ): Promise<string> {
    if (!app.imageRef) throw new Error('Application has no image reference');
    const docker = await this.remote.forServer(app.serverId);
    await log.step(
      'building',
      `Pulling ${app.imageRef}` +
        (app.imageRegistryId ? ' (authenticated)' : '') +
        (app.serverId ? ` on ${docker.engine.target}` : ''),
    );
    let auth: RegistryAuth | undefined;
    if (app.imageRegistryId) {
      const { registry, password } = await this.registries.findWithPassword(
        app.imageRegistryId,
      );
      if (password) log.redact(password);
      auth = {
        username: registry.username ?? '',
        password: password ?? '',
        serveraddress: registry.url,
      };
    }
    // Always pull so a mutable tag (`latest`) picks up the newest image.
    await docker.engine.pullImage(app.imageRef, auth);
    await log.flush();
    return app.imageRef;
  }

  /**
   * Builds (and, on the local host, pushes) the image for `branch` and returns
   * its reference. Shared by regular deployments and pull-request previews;
   * `log` receives steps/progress and redactions.
   */
  async buildImage(
    app: Application,
    branch: string,
    opts: {
      tag: string;
      docker: DockerHandle;
      registry: Registry | null;
      log: BuildLog;
      /** Image repository suffix, e.g. `-preview`; default none. */
      suffix?: string;
    },
  ): Promise<string> {
    const { docker, registry, log } = opts;
    const repoName = `${slugPart(app.project.name)}/${app.appName}${opts.suffix ?? ''}`;
    const imageName = registry
      ? `${registry.url}/${repoName}`
      : `aoox/${repoName}`;
    const imageRef = `${imageName}:${opts.tag}`;

    if (!app.gitUrl) throw new Error('Application has no git repository');
    // Credentials live only in this local; the daemon strips userinfo from
    // its own error messages, and the log redacts the token defensively.
    let remote: string = app.gitUrl;
    if (app.gitCredentialId) {
      const { username, token } = await this.credentials.resolve(
        app.gitCredentialId,
      );
      remote = GitCredentialService.authenticateUrl(
        app.gitUrl,
        username,
        token,
      );
      log.redact(token);
    }

    await log.step(
      'building',
      `Building ${imageRef} from ${app.gitUrl}#${branch}` +
        (app.gitCredentialId ? ' (authenticated)' : '') +
        (app.buildType === 'nixpacks'
          ? ' with nixpacks'
          : app.buildType === 'railpack'
            ? ' with railpack'
            : app.buildType === 'static'
              ? ' as a static site'
              : '') +
        (app.serverId ? ` on ${docker.engine.target}` : ''),
    );
    // Build args are literal (no ${{...}} expansion): they end up in the
    // image history, which is pushed to the registry.
    const buildArgs = Object.fromEntries(parseEnvLines(app.buildArgs ?? ''));
    if (app.buildType === 'static') {
      await this.staticSite.build(
        {
          remote,
          branch,
          tag: imageRef,
          buildCommand: app.staticBuildCommand,
          outputDir: app.staticOutputDir,
          spa: app.staticSpa,
          nodeVersion: DEFAULT_NODE_VERSION,
        },
        (m) => log.progress(m),
        docker,
      );
    } else if (app.buildType === 'railpack') {
      // Railpack drives BuildKit, which lives in its own container on the
      // host; a per-server BuildKit is not in scope.
      if (app.serverId) {
        throw new Error(
          'Railpack builds run on the aoox host only; use Dockerfile or nixpacks for applications on a remote server',
        );
      }
      await this.railpack.build(
        {
          remote,
          branch,
          tag: imageRef,
          buildArgs,
          cacheKey: `${app.projectId}/${app.appName}`,
        },
        (m) => log.progress(m),
      );
    } else if (app.buildType === 'nixpacks') {
      // Helper container clones (credentials never leave it) and plans;
      // the daemon builds the generated Dockerfile from a tar context.
      await this.nixpacks.build(
        { remote, branch, tag: imageRef, buildArgs },
        (m) => log.progress(m),
        docker,
      );
    } else {
      await docker.engine.buildFromGit(
        {
          remote: `${remote}#${branch}`,
          tag: imageRef,
          dockerfile: app.dockerfilePath || undefined,
          buildArgs,
        },
        (m) => log.progress(m),
      );
    }
    await log.flush();

    if (registry) {
      await log.step('pushing', `Pushing ${imageRef}`);
      const { password } = await this.registries.findWithPassword(registry.id);
      await docker.engine.pushImage(
        imageName,
        opts.tag,
        {
          username: registry.username ?? '',
          password: password ?? '',
          serveraddress: registry.url,
        },
        (m) => log.progress(m),
      );
    } else {
      await log.step(
        'pushing',
        `Image kept on the server (no registry push for remote servers)`,
      );
    }
    await log.flush();
    return imageRef;
  }

  /** Resolves the target daemon and, on the local host, the registry to push to. */
  async buildTargets(
    app: Application,
  ): Promise<{ docker: DockerHandle; registry: Registry | null }> {
    // Remote servers build on their own daemon and keep the image there:
    // the self-hosted registry is only reachable from the aoox host.
    const docker = await this.remote.forServer(app.serverId);
    const registry = app.serverId
      ? null
      : await this.registries.findSelfHosted();
    if (!app.serverId && !registry) {
      throw new Error(
        'No self-hosted registry. Provision one on the Registry page first.',
      );
    }
    return { docker, registry };
  }

  /** Re-runs a previously pushed image; the daemon pulls it from the registry if needed. */
  private async rollback(
    deployment: Deployment,
    app: Application,
    log: DeploymentLog,
  ): Promise<void> {
    const imageRef = deployment.imageRef;
    if (!imageRef) throw new Error('Rollback target has no image');
    try {
      await log.step(
        'starting',
        deployment.kind === 'config'
          ? `Applying configuration with ${imageRef}`
          : `Rolling back to ${imageRef}`,
      );
      const docker = await this.remote.forServer(app.serverId);
      await docker.ensureImage(imageRef);
      await this.replaceContainer(app, imageRef, log);
      app.status = 'running';
      app.currentImage = imageRef;
      await this.applications.repo.save(app);
      await log.finish(
        'success',
        deployment.kind === 'config'
          ? `Configuration applied (${imageRef})`
          : `Rolled back to ${imageRef}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.status = await this.statusAfterFailure(app);
      await this.applications.repo.save(app).catch(() => undefined);
      await log.finish('failed', `ERROR: ${message}`, message);
    }
  }

  /** A failed swarm update rolls back and keeps serving: only `error` when nothing runs. */
  private async statusAfterFailure(
    app: Application,
  ): Promise<ApplicationStatus> {
    if (app.deployMode !== 'service') return 'error';
    const svc = await this.swarmDeploy.status(app).catch(() => null);
    return svc && svc.running > 0 ? 'running' : 'error';
  }

  /**
   * Re-creates the running container with the current image so that runtime
   * config living on the container (proxy labels, ports, env) takes effect
   * without a rebuild. No-op when the app was never deployed.
   */
  async applyRuntimeConfig(app: Application): Promise<void> {
    if (!app.currentImage) return;
    await this.replaceContainer(app, app.currentImage);
  }

  /**
   * Same as `applyRuntimeConfig`, but as a queued `config` deployment
   * (visible in the history, never blocks the request) — used for swarm
   * changes, whose rolling update can take minutes. 409 while one runs.
   */
  async queueRuntimeConfig(app: Application): Promise<Deployment | null> {
    if (!app.currentImage) return null;
    const inFlight = await this.applications.deployments.count({
      where: {
        applicationId: app.id,
        status: In(['queued', 'building', 'pushing', 'starting']),
      },
    });
    if (inFlight > 0) {
      throw new ConflictException('A deployment is already in progress');
    }
    const deployment = await this.applications.deployments.save(
      this.applications.deployments.create({
        applicationId: app.id,
        kind: 'config',
        imageRef: app.currentImage,
        status: 'queued',
        logs: '',
      }),
    );
    this.start(deployment, app);
    return deployment;
  }

  /**
   * Starts the new image and retires the previous container (if any).
   * With `healthcheckPath` the new container must report `healthy` first;
   * for domain-routed apps without a host port that happens blue/green:
   * `<name>-next` starts beside the old one (Traefik ignores it until
   * healthy, then load-balances both), the old one is removed and `-next`
   * is renamed — no request is dropped. A failed check removes `-next` and
   * leaves the old container serving. `override` lets a pull-request
   * preview run beside the app with its own container name, router and hosts.
   */
  async replaceContainer(
    app: Application,
    imageRef: string,
    log?: BuildLog,
    override?: {
      name: string;
      routerName: string;
      domains: { host: string; https: boolean }[];
      labels?: Record<string, string>;
      /** Previews never publish host ports. */
      hostPort: number | null;
    },
  ): Promise<string> {
    const name = override?.name ?? containerNameFor(app);
    // Env is resolved here (not at build) so project vars and database
    // references reflect the current state on every (re)create.
    if (!app.project) {
      app.project = (
        await this.applications.repo.findOneOrFail({
          where: { id: app.id },
          relations: { project: true },
        })
      ).project;
    }
    const { env, secrets } = await this.envResolver.resolve(app);
    for (const s of secrets) log?.redact(s);
    // Railpack's generated servers listen on $PORT (Railway's convention,
    // default 80), so hand them the container port the user configured
    // unless the app sets PORT itself.
    if (
      app.buildType === 'railpack' &&
      !env.some((e) => e.startsWith('PORT='))
    ) {
      env.push(`PORT=${app.containerPort}`);
    }
    const docker = await this.remote.forServer(app.serverId);
    const existing = await docker.findContainerByName(name);

    // Every app joins the proxy network so Traefik can reach it by name.
    await docker.ensureNetwork(APP_NETWORK);
    // Domains are routed by the proxy of whichever daemon runs the app:
    // the host's (env settings) or the server's own Traefik (server row).
    const domains = override
      ? override.domains
      : await this.applications.domains.find({
          where: { applicationId: app.id },
        });
    const proxySettings = app.serverId
      ? proxySettingsOf(await this.servers.findOrFail(app.serverId))
      : this.proxy.localSettings;
    const routerName = override?.routerName ?? app.appName;
    const hostPort = override ? override.hostPort : app.hostPort;
    // Previews never get the app's mounts: sharing its data volume with an
    // arbitrary PR branch would be a surprise, and file mounts are config
    // meant for the real deployment.
    const mounts = override
      ? []
      : await this.applications.mounts.find({
          where: { applicationId: app.id },
          order: { createdAt: 'ASC' },
        });
    const filesMountpoint = await prepareMounts(docker, app, mounts);

    const port = `${app.containerPort}/tcp`;
    const healthcheck = app.healthcheckPath
      ? healthcheckFor(app.containerPort, app.healthcheckPath)
      : undefined;
    const containerLabels = {
      'aoox.component': 'application',
      'aoox.application': app.id,
      'aoox.project': app.projectId,
      ...composeLabels(`app-${app.appName}`),
    };
    const proxyLabels = this.proxy.labelsFor(
      routerName,
      app.containerPort,
      domains,
      proxySettings,
    );

    if (app.deployMode === 'service' && !override) {
      if (app.serverId) {
        throw new Error(
          'Swarm services run on the aoox host only; move the app off the remote server or use container mode',
        );
      }
      const spec = serviceSpecFor({
        name,
        image: imageRef,
        env,
        serviceLabels: proxyLabels,
        containerLabels,
        binds: bindsFor(app, mounts, filesMountpoint),
        healthcheck,
        limits: resourceLimits(app.cpuMillicores, app.memoryMb),
        replicas: app.replicas,
        containerPort: app.containerPort,
        hostPort,
        network: SWARM_NETWORK,
        logConfig: this.docker.logConfig,
        // Volumes and file mounts exist on this daemon only: pin such apps
        // here; otherwise honour the chosen node (null = anywhere).
        constraints: await this.placementFor(app, mounts.length > 0),
        update: {
          parallelism: app.updateParallelism,
          delaySeconds: app.updateDelaySeconds,
          order: app.updateOrder,
        },
      });
      return this.swarmDeploy.deploy(
        app,
        spec,
        await this.registryAuthFor(app, imageRef),
        log,
      );
    }
    // Switched back from service mode: the service must go before its
    // replacement container binds the same port / volumes.
    if (!override) await this.swarmDeploy.remove(app).catch(() => undefined);

    // Two containers cannot publish the same host port, so blue/green is
    // only possible when traffic arrives through the proxy.
    const blueGreen = !!healthcheck && !hostPort && !override && !!existing;
    const createName = blueGreen ? `${name}-next` : name;
    if (blueGreen) {
      // A `-next` left over from a crashed deploy must not shadow this one.
      const stale = await docker.findContainerByName(createName);
      if (stale) await docker.engine.removeContainer(stale.Id, true);
    } else if (existing) {
      await docker.engine.removeContainer(existing.Id, true);
    }
    const id = await docker.engine.createContainer(
      {
        Image: imageRef,
        Env: env,
        Healthcheck: healthcheck,
        Labels: {
          ...containerLabels,
          ...proxyLabels,
          ...override?.labels,
        },
        ExposedPorts: { [port]: {} },
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          LogConfig: this.docker.logConfig,
          NetworkMode: APP_NETWORK,
          PortBindings: hostPort
            ? { [port]: [{ HostPort: String(hostPort) }] }
            : {},
          Binds: bindsFor(app, mounts, filesMountpoint),
          ...resourceLimits(app.cpuMillicores, app.memoryMb),
        },
      },
      createName,
    );
    await docker.engine.startContainer(id);
    if (healthcheck) {
      await log?.step(
        'starting',
        `Waiting for health check at ${app.healthcheckPath}${blueGreen ? ' (old container keeps serving)' : ''}`,
      );
      try {
        await this.waitHealthy(docker, id);
      } catch (err) {
        if (blueGreen) {
          await docker.engine.removeContainer(id, true).catch(() => undefined);
        }
        throw err;
      }
      if (blueGreen && existing) {
        // Traefik learns about the healthy container from a Docker event a
        // moment later; give it time to add the server before the old one goes.
        await new Promise((r) => setTimeout(r, this.proxySettleMs));
        await docker.engine.removeContainer(existing.Id, true);
        await docker.engine.renameContainer(id, name);
      }
      await log?.step('starting', 'Health check passed');
    }
    return id;
  }

  private async placementFor(
    app: Application,
    hasMounts: boolean,
  ): Promise<string[]> {
    const out: string[] = [];
    if (hasMounts) {
      const local = await this.swarm.localNodeId();
      if (local) out.push(`node.id==${local}`);
    } else if (app.swarmNodeId) {
      out.push(`node.id==${app.swarmNodeId}`);
    }
    if (app.swarmConstraint) out.push(app.swarmConstraint);
    return out;
  }

  /**
   * Credentials the daemon needs to resolve `imageRef` when creating a
   * service (swarm records the image digest from the registry): the
   * self-hosted registry for built images, the app's registry for pulled ones.
   */
  private async registryAuthFor(
    app: Application,
    imageRef: string,
  ): Promise<RegistryAuth | undefined> {
    const id =
      app.sourceType === 'image'
        ? app.imageRegistryId
        : ((await this.registries.findSelfHosted())?.id ?? null);
    if (!id) return undefined;
    const { registry, password } = await this.registries.findWithPassword(id);
    if (!imageRef.startsWith(registry.url)) return undefined;
    return {
      username: registry.username ?? '',
      password: password ?? '',
      serveraddress: registry.url,
    };
  }

  /** Poll interval for waitHealthy; tests shorten it. */
  healthPollMs = 2000;
  /** Grace for the proxy to pick up the new container before the old one is removed. */
  proxySettleMs = 3000;

  /** Polls Docker's own health status; rejects with the probe's last output. */
  private async waitHealthy(docker: DockerHandle, id: string): Promise<void> {
    const deadline = Date.now() + HEALTHCHECK_WAIT_MS;
    let last: { ExitCode: number; Output: string } | undefined;
    let unhealthy = false;
    while (Date.now() < deadline) {
      const c = await docker.engine.inspectContainer(id);
      const health = c?.State.Health;
      if (!c || !c.State.Running) {
        throw new Error(
          `Container exited with code ${c?.State.ExitCode ?? '?'} before becoming healthy`,
        );
      }
      if (health?.Status === 'healthy') return;
      last = health?.Log?.at(-1) ?? last;
      if (health?.Status === 'unhealthy') {
        unhealthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, this.healthPollMs));
    }
    const output = last?.Output.trim().slice(0, 300);
    // 127 = "command not found" from every probe in the chain.
    const hint =
      last?.ExitCode === 127
        ? ' — the image has none of wget, curl, node or python3, so nothing can probe it'
        : '';
    throw new Error(
      `Health check ${unhealthy ? 'failed' : 'timed out'}` +
        (last
          ? ` (probe exit ${last.ExitCode}${output ? `: ${output}` : ''})`
          : '') +
        hint,
    );
  }
}

function slugPart(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

/** What the runner needs from a log sink (deployment row or preview row). */
export interface BuildLog {
  redact(secret: string): void;
  step(status: DeploymentStatus, line: string): Promise<void>;
  progress(m: BuildProgress): void;
  flush(force?: boolean): Promise<void>;
}

/** Buffers progress lines and persists them to the deployment row in batches. */
class DeploymentLog implements BuildLog {
  private buffer = '';
  private lastFlush = 0;
  private secrets: string[] = [];

  constructor(
    private readonly deployment: Deployment,
    private readonly applications: ApplicationService,
    private readonly events: DeploymentEventsService,
  ) {}

  /** Registers a secret that must never appear in persisted or streamed logs. */
  redact(secret: string): void {
    if (secret) this.secrets.push(secret, encodeURIComponent(secret));
  }

  /** Appends text: emitted live immediately, persisted in batches. */
  private append(raw: string): void {
    let chunk = raw;
    for (const s of this.secrets) chunk = chunk.split(s).join('***');
    this.buffer += chunk;
    this.events.emitLog({
      deploymentId: this.deployment.id,
      applicationId: this.deployment.applicationId,
      chunk,
    });
  }

  private setStatus(status: DeploymentStatus): void {
    this.deployment.status = status;
    this.events.emitStatus({
      deploymentId: this.deployment.id,
      applicationId: this.deployment.applicationId,
      status,
    });
  }

  async step(status: DeploymentStatus, line: string): Promise<void> {
    this.setStatus(status);
    this.append(`\n==> ${line}\n`);
    await this.flush(true);
  }

  progress(m: BuildProgress): void {
    if (m.stream) this.append(m.stream);
    else if (m.status && !m.progress) {
      this.append(m.id ? `${m.id}: ${m.status}\n` : `${m.status}\n`);
    }
    if (Date.now() - this.lastFlush > 1000) void this.flush();
  }

  async flush(force = false): Promise<void> {
    if (!this.buffer && !force) return;
    this.deployment.logs += this.buffer;
    this.buffer = '';
    this.lastFlush = Date.now();
    await this.applications.deployments.save(this.deployment);
  }

  async finish(
    status: DeploymentStatus,
    line: string,
    errorMessage: string | null = null,
  ): Promise<void> {
    let redactedError = errorMessage;
    for (const s of this.secrets) {
      redactedError = redactedError?.split(s).join('***') ?? null;
    }
    this.deployment.errorMessage = redactedError;
    this.deployment.finishedAt = new Date();
    this.append(`\n${line}\n`);
    // Persist before announcing the terminal status so subscribers that
    // re-read the row on "finished" see the complete log.
    this.deployment.status = status;
    await this.flush(true);
    this.setStatus(status);
  }
}
