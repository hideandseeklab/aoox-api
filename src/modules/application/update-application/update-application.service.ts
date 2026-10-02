import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { In } from 'typeorm';
import { limitsRemoved, resourceLimits } from '../../docker/resource-limits';
import { HostPortService } from '../../host-port/host-port.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ServerService } from '../../server/server.service';
import { GitCredentialService } from '../../git-credential/git-credential.service';
import { Application } from '../application.entity';
import { SwarmService } from '../../swarm/swarm.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { EnvReferenceError, EnvResolverService } from '../env-resolver.service';
import { isOwnContainer } from '../own-container';
import { normalizeRootDirectory } from '../root-directory';
import { UpdateApplicationDto } from './update-application.dto';

/**
 * Settings. Most take effect on the next deployment; the host port, domains
 * and resource limits are applied to the running app right away.
 */
@Injectable()
export class UpdateApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly credentials: GitCredentialService,
    private readonly envResolver: EnvResolverService,
    private readonly servers: ServerService,
    private readonly remote: RemoteDockerService,
    private readonly runner: DeploymentRunnerService,
    private readonly swarm: SwarmService,
    private readonly hostPorts: HostPortService,
  ) {}

  async execute(
    ownerId: string,
    id: string,
    dto: UpdateApplicationDto,
    actorEmail: string,
  ): Promise<Application> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    const hostPortBefore = app.hostPort;
    const serverIdBefore = app.serverId;
    if (dto.name !== undefined) app.name = dto.name.trim();
    if (dto.sourceType !== undefined) app.sourceType = dto.sourceType;
    if (dto.gitUrl !== undefined) app.gitUrl = dto.gitUrl.trim() || null;
    if (dto.imageRef !== undefined) {
      const next = dto.imageRef.trim() || null;
      // A new reference needs a fresh baseline (recorded by the next deploy/check).
      if (next !== app.imageRef) app.imageDigest = null;
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
      // Catch a bad ${{...}} reference now rather than at the next deploy.
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
    // Refuse rather than race a running deployment: it holds its own copy of
    // the app (loaded when it was queued) and would create its container with
    // the old port — and its final save would write that old port back over
    // this change.
    if (hostPortChanged && (await this.hasActiveDeployment(app.id))) {
      throw new ConflictException(
        'A deployment is in progress; change the host port after it finishes',
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
    const saved = await this.applications.repo.save(app);
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
    if (hostPortChanged && saved.currentImage && saved.status === 'running') {
      await this.applyHostPort(saved, hostPortBefore, actorEmail);
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
    hostPortBefore: number | null,
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
      saved.hostPort = hostPortBefore;
      await this.applications.repo.save(saved);
      try {
        await this.runner.applyRuntimeConfig(saved);
      } catch (restoreErr) {
        saved.status = 'error';
        await this.applications.repo.save(saved).catch(() => undefined);
        const restore =
          restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
        throw new ConflictException(
          `Could not apply the new host port (${reason}) and restoring the previous one failed (${restore}); redeploy the application`,
        );
      }
      throw new ConflictException(
        `Could not apply the new host port (${reason}); the previous port was restored`,
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
