import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { normalizeBind } from '../../docker/host-port-bind';
import { HostPortService } from '../../host-port/host-port.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ServerService } from '../../server/server.service';
import { SwarmService } from '../../swarm/swarm.service';
import { GitCredentialService } from '../../git-credential/git-credential.service';
import { ProjectService } from '../../project/project.service';
import { Application } from '../application.entity';
import { ApplicationService } from '../application.service';
import { normalizeRootDirectory } from '../root-directory';
import { OwnerVariableSetsService } from '../variable-set-links/variable-set-links.service';
import { CreateApplicationDto } from './create-application.dto';

@Injectable()
export class CreateApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly projects: ProjectService,
    private readonly variableSets: OwnerVariableSetsService,
    private readonly credentials: GitCredentialService,
    private readonly servers: ServerService,
    private readonly swarm: SwarmService,
    private readonly hostPorts: HostPortService,
    private readonly remote: RemoteDockerService,
  ) {}

  async execute(
    ownerId: string,
    dto: CreateApplicationDto,
  ): Promise<Application> {
    const project = await this.projects.findOwnedOrFail(dto.projectId, ownerId);
    if (dto.gitCredentialId) {
      await this.credentials.findOrFail(dto.gitCredentialId);
    }
    if (dto.serverId) await this.servers.findOrFail(dto.serverId);
    if (dto.hostPort != null) {
      const docker = await this.remote.forServer(dto.serverId ?? null);
      await this.hostPorts.assertFree([dto.hostPort], docker);
    }
    if (
      dto.deployMode === 'service' &&
      dto.hostPort != null &&
      dto.hostPortBind === 'loopback'
    ) {
      throw new BadRequestException(
        'A Swarm service cannot publish its host port on 127.0.0.1 only; use a public port or container mode',
      );
    }
    if (dto.deployMode === 'service') {
      if (dto.serverId) {
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
    const app = this.applications.repo.create({
      projectId: project.id,
      name: dto.name.trim(),
      appName: ApplicationService.slugify(dto.name),
      sourceType: dto.sourceType ?? 'git',
      gitUrl: dto.gitUrl?.trim() || null,
      imageRef:
        dto.sourceType === 'image' ? (dto.imageRef?.trim() ?? null) : null,
      imageRegistryId:
        dto.sourceType === 'image' ? (dto.imageRegistryId ?? null) : null,
      autoUpdate:
        dto.sourceType === 'image' ? (dto.autoUpdate ?? false) : false,
      autoUpdateFollowTags:
        dto.sourceType === 'image'
          ? (dto.autoUpdate ?? false) && (dto.autoUpdateFollowTags ?? false)
          : false,
      autoUpdateIntervalMinutes: dto.autoUpdateIntervalMinutes ?? 60,
      gitBranch: dto.gitBranch?.trim() || 'main',
      dockerfilePath: dto.dockerfilePath?.trim() || 'Dockerfile',
      rootDirectory: normalizeRootDirectory(dto.rootDirectory),
      watchRootOnly: dto.watchRootOnly ?? false,
      gitCredentialId: dto.gitCredentialId ?? null,
      webhookToken: randomBytes(24).toString('base64url'),
      containerPort: dto.containerPort ?? 3000,
      hostPort: dto.hostPort ?? null,
      hostPortBind: normalizeBind(dto.hostPortBind),
      cpuMillicores: dto.cpuMillicores ?? null,
      healthcheckPath: dto.healthcheckPath?.trim() || null,
      memoryMb: dto.memoryMb ?? null,
      deploymentKeep: dto.deploymentKeep ?? 10,
      env: dto.env ?? '',
      buildArgs: dto.buildArgs ?? '',
      buildType: dto.buildType ?? 'dockerfile',
      staticBuildCommand: dto.staticBuildCommand?.trim() || null,
      staticOutputDir: dto.staticOutputDir?.trim() || 'dist',
      staticSpa: dto.staticSpa ?? true,
      serverId: dto.serverId ?? null,
      previewsEnabled: dto.previewsEnabled ?? false,
      previewDomain: dto.previewDomain?.trim() || null,
      deployMode: dto.deployMode ?? 'container',
      replicas: dto.replicas ?? 1,
      swarmNodeId: dto.swarmNodeId ?? null,
      swarmConstraint: dto.swarmConstraint?.trim() || null,
      updateParallelism: dto.updateParallelism ?? 1,
      updateDelaySeconds: dto.updateDelaySeconds ?? 2,
      updateOrder: dto.updateOrder ?? 'auto',
    });
    // Without links the application has none (no default environment).
    const links = (dto.variableSetLinks ?? []).map((l) => l.environmentId);
    const owner = { kind: 'application' as const, projectId: project.id };
    if (links.length > 0) {
      await this.variableSets.check(owner, app, links, ownerId);
    }
    const saved = await this.applications.repo.save(app);
    if (links.length > 0) {
      await this.variableSets.replace(
        { ...owner, id: saved.id },
        saved,
        links,
        ownerId,
      );
    }
    // The entity still carries the webhook token it was built with.
    const { webhookToken: _omit, ...safe } = saved;
    void _omit;
    return safe as Application;
  }
}
