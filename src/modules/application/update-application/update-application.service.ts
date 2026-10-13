import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { In } from 'typeorm';
import { CertificateSyncService } from '../../certificate/certificate-sync.service';
import { ProxyDnsBindingService } from '../../dns-provider/proxy-dns-binding.service';
import { limitsRemoved, resourceLimits } from '../../docker/resource-limits';
import { HostPortService } from '../../host-port/host-port.service';
import { ProxyConfigService } from '../../proxy-config/proxy-config.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ServerService } from '../../server/server.service';
import { GitCredentialService } from '../../git-credential/git-credential.service';
import { Application } from '../application.entity';
import { Domain } from '../domain.entity';
import { SwarmService } from '../../swarm/swarm.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { EnvReferenceError, EnvResolverService } from '../env-resolver.service';
import { isOwnContainer } from '../own-container';
import { normalizeRootDirectory } from '../root-directory';
import { UpdateApplicationDto } from './update-application.dto';

/** Middlewares removed from a domain because the new proxy does not define them. */
export interface DroppedMiddlewares {
  domain: string;
  names: string[];
}

/**
 * Settings. Most take effect on the next deployment; the host port, domains
 * and resource limits are applied to the running app right away.
 */
@Injectable()
export class UpdateApplicationService {
  private readonly logger = new Logger(UpdateApplicationService.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly credentials: GitCredentialService,
    private readonly envResolver: EnvResolverService,
    private readonly servers: ServerService,
    private readonly remote: RemoteDockerService,
    private readonly runner: DeploymentRunnerService,
    private readonly swarm: SwarmService,
    private readonly hostPorts: HostPortService,
    private readonly proxyConfig: ProxyConfigService,
    private readonly certSync: CertificateSyncService,
    private readonly dnsBindings: ProxyDnsBindingService,
  ) {}

  async execute(
    ownerId: string,
    id: string,
    dto: UpdateApplicationDto,
    actorEmail: string,
  ): Promise<
    Application & {
      droppedMiddlewares?: DroppedMiddlewares[];
      certificateSyncError?: string;
    }
  > {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    const hostPortBefore = app.hostPort;
    const containerPortBefore = app.containerPort;
    const serverIdBefore = app.serverId;
    // The maintenance page lives on the proxy of the current server only.
    if (
      app.maintenanceEnabled &&
      dto.serverId !== undefined &&
      (dto.serverId || null) !== serverIdBefore
    ) {
      throw new ConflictException(
        'Turn maintenance mode off before moving the application to another server',
      );
    }
    let digestReset = false;
    if (dto.name !== undefined) app.name = dto.name.trim();
    if (dto.sourceType !== undefined) app.sourceType = dto.sourceType;
    if (dto.gitUrl !== undefined) app.gitUrl = dto.gitUrl.trim() || null;
    if (dto.imageRef !== undefined) {
      const next = dto.imageRef.trim() || null;
      // A new reference needs a fresh baseline (recorded by the next deploy/check).
      if (next !== app.imageRef) {
        app.imageDigest = null;
        digestReset = true;
      }
      app.imageRef = next;
    }
    if (dto.imageRegistryId !== undefined)
      app.imageRegistryId = dto.imageRegistryId;
    if (dto.autoUpdate !== undefined) app.autoUpdate = dto.autoUpdate;
    if (dto.autoUpdateIntervalMinutes !== undefined)
      app.autoUpdateIntervalMinutes = dto.autoUpdateIntervalMinutes;
    if (app.sourceType !== 'image') app.autoUpdate = false;
    if (app.sourceType === 'image' && !app.imageRef) {
      throw new BadRequestException(
        'imageRef is required for the image source',
      );
    }
    if (app.sourceType === 'git' && !app.gitUrl) {
      throw new BadRequestException('gitUrl is required for the git source');
    }
    if (dto.gitBranch !== undefined)
      app.gitBranch = dto.gitBranch.trim() || 'main';
    if (dto.dockerfilePath !== undefined) {
      app.dockerfilePath = dto.dockerfilePath.trim() || 'Dockerfile';
    }
    if (dto.rootDirectory !== undefined)
      app.rootDirectory = normalizeRootDirectory(dto.rootDirectory);
    if (dto.watchRootOnly !== undefined) app.watchRootOnly = dto.watchRootOnly;
    if (dto.gitCredentialId !== undefined) {
      if (dto.gitCredentialId)
        await this.credentials.findOrFail(dto.gitCredentialId);
      app.gitCredentialId = dto.gitCredentialId;
    }
    if (dto.containerPort !== undefined) app.containerPort = dto.containerPort;
    if (dto.hostPort !== undefined) app.hostPort = dto.hostPort;
    const before = { cpuMillicores: app.cpuMillicores, memoryMb: app.memoryMb };
    if (dto.cpuMillicores !== undefined) app.cpuMillicores = dto.cpuMillicores;
    if (dto.deploymentKeep !== undefined)
      app.deploymentKeep = dto.deploymentKeep;
    if (dto.memoryMb !== undefined) app.memoryMb = dto.memoryMb;
    if (dto.healthcheckPath !== undefined)
      app.healthcheckPath = dto.healthcheckPath?.trim() || null;
    if (dto.ignoreErrorLogs !== undefined)
      app.ignoreErrorLogs = dto.ignoreErrorLogs;
    const limitsChanged =
      before.cpuMillicores !== app.cpuMillicores ||
      before.memoryMb !== app.memoryMb;
    if (dto.env !== undefined) {
      app.env = dto.env;
      // Catch a bad ${{...}} reference now rather than at the next deploy
      // (`${{vars.KEY}}` is checked against the app's linked variable sets).
      try {
        await this.envResolver.resolve(app, { lenient: true });
      } catch (err) {
        if (err instanceof EnvReferenceError) {
          throw new BadRequestException(err.message);
        }
        throw err;
      }
    }
    if (dto.buildArgs !== undefined) app.buildArgs = dto.buildArgs;
    if (dto.buildType !== undefined) app.buildType = dto.buildType;
    if (dto.staticBuildCommand !== undefined)
      app.staticBuildCommand = dto.staticBuildCommand?.trim() || null;
    if (dto.staticOutputDir !== undefined)
      app.staticOutputDir = dto.staticOutputDir.trim() || 'dist';
    if (dto.staticSpa !== undefined) app.staticSpa = dto.staticSpa;
    if (dto.previewsEnabled !== undefined)
      app.previewsEnabled = dto.previewsEnabled;
    if (dto.previewDomain !== undefined)
      app.previewDomain = dto.previewDomain?.trim() || null;
    if (dto.previewWildcardCert !== undefined) {
      if (
        dto.previewWildcardCert &&
        !app.previewWildcardCert &&
        !(await this.dnsBindings.get(dto.serverId ?? app.serverId ?? null))
      ) {
        throw new BadRequestException(
          'Enable DNS-01 on this proxy first (Infrastructure, Proxy, DNS-01 certificates)',
        );
      }
      app.previewWildcardCert = dto.previewWildcardCert;
    }
    if (dto.serverId !== undefined) {
      if (dto.serverId) await this.servers.findOrFail(dto.serverId);
      app.serverId = dto.serverId;
    }
    const modeBefore = app.deployMode;
    const replicasBefore = app.replicas;
    const nodeBefore = app.swarmNodeId;
    const swarmBefore = JSON.stringify([
      app.swarmConstraint,
      app.updateParallelism,
      app.updateDelaySeconds,
      app.updateOrder,
    ]);
    if (dto.deployMode !== undefined) app.deployMode = dto.deployMode;
    if (dto.replicas !== undefined) app.replicas = dto.replicas;
    if (dto.swarmNodeId !== undefined) app.swarmNodeId = dto.swarmNodeId;
    if (dto.swarmConstraint !== undefined)
      app.swarmConstraint = dto.swarmConstraint?.trim() || null;
    if (dto.updateParallelism !== undefined)
      app.updateParallelism = dto.updateParallelism;
    if (dto.updateDelaySeconds !== undefined)
      app.updateDelaySeconds = dto.updateDelaySeconds;
    if (dto.updateOrder !== undefined) app.updateOrder = dto.updateOrder;
    const swarmChanged =
      swarmBefore !==
      JSON.stringify([
        app.swarmConstraint,
        app.updateParallelism,
        app.updateDelaySeconds,
        app.updateOrder,
      ]);
    if (app.deployMode === 'service') {
      if (app.serverId) {
        throw new BadRequestException(
          'Swarm services run on the aoox host only',
        );
      }
      if (!(await this.swarm.isActive())) {
        throw new BadRequestException(
          'This host is not a swarm manager; initialise the swarm on the Settings page first',
        );
      }
    }
    const hostPortChanged = app.hostPort !== hostPortBefore;
    // The container port lives in the proxy labels (and the Railpack PORT
    // env) of the running container, so it is applied like a host port.
    const containerPortChanged = app.containerPort !== containerPortBefore;
    // Refuse rather than race a running deployment: it holds its own copy of
    // the app (loaded when it was queued) and would create its container with
    // the old port — and its final save would write that old port back over
    // this change.
    if (
      (hostPortChanged || containerPortChanged) &&
      (await this.hasActiveDeployment(app.id))
    ) {
      throw new ConflictException(
        `A deployment is in progress; change the ${hostPortChanged ? 'host' : 'container'} port after it finishes`,
      );
    }
    // A moved server needs the new daemon re-checked even for an unchanged
    // port; an unchanged port on the same daemon has already proven itself.
    if (
      app.hostPort != null &&
      (app.hostPort !== hostPortBefore || app.serverId !== serverIdBefore)
    ) {
      const docker = await this.remote.forServer(app.serverId);
      await this.hostPorts.assertFree([app.hostPort], docker, {
        excludeApplicationId: app.id,
        isOwnContainer: isOwnContainer(app),
      });
    }
    await this.refreshRunnerColumns(app, digestReset);
    const saved = await this.applications.repo.save(app);
    // Moved to another proxy: middlewares of its domains that the new proxy does
    // not define would leave routers pointing at nothing. Cleaned before any
    // path below recreates the container (labels) or the next deploy does.
    if (saved.serverId !== serverIdBefore) {
      const rows = await this.applications.domains.find({
        where: { applicationId: saved.id },
      });
      const dropped = await this.pruneDomainMiddlewares(saved, rows);
      // Additive and only when something was dropped: the answer keeps its shape otherwise.
      if (dropped.length > 0) {
        Object.assign(saved, { droppedMiddlewares: dropped });
      }
      // Custom certificates follow the app: written on the new daemon, swept on the old.
      const certError = await this.moveCertificates(
        saved,
        rows,
        serverIdBefore,
      );
      if (certError) Object.assign(saved, { certificateSyncError: certError });
    }
    // Mode or replica changes are applied by re-deploying the current image
    // (service <-> container swap, or a scale of the running service).
    if (
      saved.currentImage &&
      (modeBefore !== saved.deployMode ||
        replicasBefore !== saved.replicas ||
        nodeBefore !== saved.swarmNodeId ||
        (saved.deployMode === 'service' && swarmChanged))
    ) {
      // A rolling update can take minutes: run it as a `config` deployment.
      await this.runner.queueRuntimeConfig(saved, actorEmail);
      return saved;
    }
    // A stopped app keeps its container (and its old ports): the next start
    // notices the drift and recreates it (see StartApplicationService).
    if (
      (hostPortChanged || containerPortChanged) &&
      saved.currentImage &&
      saved.status === 'running'
    ) {
      await this.applyHostPort(
        saved,
        { hostPort: hostPortBefore, containerPort: containerPortBefore },
        hostPortChanged ? 'host port' : 'container port',
        actorEmail,
      );
      return saved;
    }
    // Limits apply now rather than at the next
    // deployment: live via ContainerUpdate, or by recreating the container
    // when a limit is being removed (0 = "unchanged" for the update call).
    if (limitsChanged) {
      // A service carries its limits in the spec: always a rolling update.
      if (saved.deployMode === 'service')
        await this.runner.queueRuntimeConfig(saved, actorEmail);
      else if (limitsRemoved(before, saved))
        await this.runner.applyRuntimeConfig(saved);
      else await this.applyLimits(saved);
    }
    return saved;
  }

  /**
   * Keeps, for every domain of the app, only the middlewares that an ENABLED
   * dynamic config file on the app's (new) proxy defines; the rest is dropped
   * and logged per domain. Certificates are handled by `moveCertificates`.
   */
  private async pruneDomainMiddlewares(
    app: Application,
    rows: Domain[],
  ): Promise<DroppedMiddlewares[]> {
    const withMiddlewares = rows.filter(
      (d) => (d.middlewares ?? []).length > 0,
    );
    if (withMiddlewares.length === 0) return [];
    const known = new Set(
      (await this.proxyConfig.availableMiddlewares(app.serverId)).map(
        (m) => m.ref,
      ),
    );
    const dropped: DroppedMiddlewares[] = [];
    for (const d of withMiddlewares) {
      const kept = d.middlewares.filter((m) => known.has(m));
      const gone = d.middlewares.filter((m) => !known.has(m));
      if (gone.length === 0) continue;
      d.middlewares = kept;
      await this.applications.domains.save(d);
      this.logger.warn(
        `Application ${app.appName} moved proxy: dropped middlewares ${gone.join(', ')} from ${d.host} (not defined on the new proxy)`,
      );
      dropped.push({ domain: d.host, names: gone });
    }
    return dropped;
  }

  /**
   * After a server move, a domain that uses a custom certificate needs the
   * certificate files in the NEW daemon's proxy volume (otherwise Traefik
   * serves its self-signed default there) and the old daemon should drop the
   * ones nothing uses any more. Goes through `CertificateSyncService`, which
   * serializes writes per daemon (and may recreate an old proxy once, as for
   * any certificate). Returns an error message only when the DESTINATION sync
   * failed — the move itself stands; the origin sweep is best effort.
   */
  private async moveCertificates(
    app: Application,
    rows: Domain[],
    fromServerId: string | null,
  ): Promise<string | null> {
    if (!rows.some((d) => d.certificateId)) return null;
    let error: string | null = null;
    try {
      await this.certSync.syncServer(app.serverId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Application ${app.appName} moved server: certificate sync to the new server failed: ${reason}`,
      );
      error = `The application moved, but its certificate files could not be written to the new server (${reason}). Save the domain or the certificate again to retry.`;
    }
    try {
      await this.certSync.syncServer(fromServerId);
    } catch (err) {
      this.logger.warn(
        `Application ${app.appName} moved server: certificate cleanup on the old server failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return error;
  }

  /**
   * The other half of the race: a deployment can finish between loading the
   * app and saving it (port checks and env validation await Docker and
   * registries). `save` would then write the stale `status`/`currentImage`/
   * digest back over what the runner just recorded, so those columns — which
   * the settings never edit — are re-read right before the save.
   */
  private async refreshRunnerColumns(
    app: Application,
    digestReset: boolean,
  ): Promise<void> {
    const fresh = await this.applications.repo.findOne({
      where: { id: app.id },
      select: {
        id: true,
        status: true,
        currentImage: true,
        imageDigest: true,
        imageCheckedAt: true,
      },
    });
    if (!fresh) return;
    app.status = fresh.status;
    app.currentImage = fresh.currentImage;
    app.imageCheckedAt = fresh.imageCheckedAt;
    if (!digestReset) app.imageDigest = fresh.imageDigest;
  }

  private async hasActiveDeployment(applicationId: string): Promise<boolean> {
    return (
      (await this.applications.deployments.count({
        where: {
          applicationId,
          status: In(['queued', 'building', 'pushing', 'starting']),
        },
      })) > 0
    );
  }

  /**
   * Publishing (or dropping) a host port lives on the container, so the
   * running app is recreated from its current image — no rebuild. A service
   * is a rolling update, so it runs as a queued `config` deployment.
   *
   * The container path removes the old container before creating the new
   * one (a host port cannot be bound twice), so if that fails (e.g. another
   * process took the port after the conflict check) the previous port is
   * restored — in the database and on the daemon — instead of leaving the
   * app with no container and a setting that was never applied.
   */
  private async applyHostPort(
    saved: Application,
    before: { hostPort: number | null; containerPort: number },
    label: string,
    actorEmail: string,
  ): Promise<void> {
    if (saved.deployMode === 'service') {
      await this.runner.queueRuntimeConfig(saved, actorEmail);
      return;
    }
    try {
      await this.runner.applyRuntimeConfig(saved);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      saved.hostPort = before.hostPort;
      saved.containerPort = before.containerPort;
      await this.applications.repo.save(saved);
      try {
        await this.runner.applyRuntimeConfig(saved);
      } catch (restoreErr) {
        saved.status = 'error';
        await this.applications.repo.save(saved).catch(() => undefined);
        const restore =
          restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
        throw new ConflictException(
          `Could not apply the new ${label} (${reason}) and restoring the previous one failed (${restore}); redeploy the application`,
        );
      }
      throw new ConflictException(
        `Could not apply the new ${label} (${reason}); the previous port was restored`,
      );
    }
  }

  private async applyLimits(app: Application): Promise<void> {
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker.findContainerByName(containerNameFor(app));
    if (!c) return;
    await docker.engine.updateContainer(
      c.Id,
      resourceLimits(app.cpuMillicores, app.memoryMb),
    );
  }
}
