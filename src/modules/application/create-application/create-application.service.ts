import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ServerService } from '../../server/server.service';
import { SwarmService } from '../../swarm/swarm.service';
import { GitCredentialService } from '../../git-credential/git-credential.service';
import { ProjectService } from '../../project/project.service';
import { Application } from '../application.entity';
import { ApplicationService } from '../application.service';
import { CreateApplicationDto } from './create-application.dto';

@Injectable()
export class CreateApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly projects: ProjectService,
    private readonly credentials: GitCredentialService,
    private readonly servers: ServerService,
    private readonly swarm: SwarmService,
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
      gitUrl: dto.gitUrl?.trim() ?? null,
      imageRef:
        dto.sourceType === 'image' ? (dto.imageRef?.trim() ?? null) : null,
      imageRegistryId:
        dto.sourceType === 'image' ? (dto.imageRegistryId ?? null) : null,
      autoUpdate:
        dto.sourceType === 'image' ? (dto.autoUpdate ?? false) : false,
      autoUpdateIntervalMinutes: dto.autoUpdateIntervalMinutes ?? 60,
      gitBranch: dto.gitBranch?.trim() || 'main',
      dockerfilePath: dto.dockerfilePath?.trim() || 'Dockerfile',
      gitCredentialId: dto.gitCredentialId ?? null,
      webhookToken: randomBytes(24).toString('base64url'),
      containerPort: dto.containerPort ?? 3000,
      hostPort: dto.hostPort ?? null,
      cpuMillicores: dto.cpuMillicores ?? null,
      healthcheckPath: dto.healthcheckPath?.trim() || null,
      memoryMb: dto.memoryMb ?? null,
      deploymentKeep: dto.deploymentKeep ?? 10,
      env: dto.env ?? '',
      buildArgs: dto.buildArgs ?? '',
      buildType: dto.buildType ?? 'dockerfile',
      staticBuildCommand: dto.staticBuildCommand ?? null,
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
    return this.applications.repo.save(app);
  }
}
