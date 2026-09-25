import { Injectable } from '@nestjs/common';
import { ApplicationService } from '../application/application.service';
import { Mount } from '../application/mount.entity';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import { ComposeService } from '../compose/compose.service';
import { GitCredentialService } from '../git-credential/git-credential.service';
import { Job } from '../job/job.entity';
import { JobService } from '../job/job.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { Project } from '../project/project.entity';
import { RegistryService } from '../registry/registry.service';
import { ServerService } from '../server/server.service';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ExportedJob,
  ExportedMount,
  ProjectExport,
} from './project-export.types';

/** Builds the portable JSON for one project (see project-export.types.ts). */
@Injectable()
export class ProjectExportService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly databases: ManagedDatabaseService,
    private readonly compose: ComposeService,
    private readonly jobs: JobService,
    private readonly registries: RegistryService,
    private readonly credentials: GitCredentialService,
    private readonly destinations: BackupDestinationService,
    private readonly servers: ServerService,
  ) {}

  async export(
    project: Project,
    includeSecrets: boolean,
  ): Promise<ProjectExport> {
    // Name lookups for references (a handful of rows each).
    const nameOf = async <T extends { id: string; name: string }>(
      rows: Promise<T[]>,
    ) => new Map((await rows).map((r) => [r.id, r.name] as const));
    const [registryNames, credentialNames, destinationNames, serverNames] =
      await Promise.all([
        nameOf(this.registries.repo.find()),
        nameOf(this.credentials.repo.find()),
        nameOf(this.destinations.repo.find()),
        nameOf(this.servers.repo.find()),
      ]);
    const ref = (map: Map<string, string>, id: string | null) =>
      id ? (map.get(id) ?? null) : null;

    const apps = await this.applications.repo.find({
      where: { projectId: project.id },
      order: { createdAt: 'ASC' },
    });
    const applications = await Promise.all(
      apps.map(async (a) => ({
        name: a.name,
        appName: a.appName,
        sourceType: a.sourceType,
        gitUrl: a.gitUrl,
        gitBranch: a.gitBranch,
        imageRef: a.imageRef,
        dockerfilePath: a.dockerfilePath,
        buildType: a.buildType,
        staticBuildCommand: a.staticBuildCommand,
        staticOutputDir: a.staticOutputDir,
        staticSpa: a.staticSpa,
        containerPort: a.containerPort,
        hostPort: a.hostPort,
        env: a.env,
        buildArgs: a.buildArgs,
        healthcheckPath: a.healthcheckPath,
        deploymentKeep: a.deploymentKeep,
        backupCron: a.backupCron,
        backupKeep: a.backupKeep,
        cpuMillicores: a.cpuMillicores,
        memoryMb: a.memoryMb,
        previewsEnabled: a.previewsEnabled,
        previewDomain: a.previewDomain,
        references: {
          gitCredential: ref(credentialNames, a.gitCredentialId),
          imageRegistry: ref(registryNames, a.imageRegistryId),
          backupDestination: ref(destinationNames, a.backupDestinationId),
          server: ref(serverNames, a.serverId),
        },
        domains: (
          await this.applications.domains.find({
            where: { applicationId: a.id },
          })
        ).map((d) => ({ host: d.host, https: d.https })),
        mounts: (
          await this.applications.mounts.find({
            where: { applicationId: a.id },
            order: { createdAt: 'ASC' },
          })
        ).map(exportMount),
        jobs: (
          await this.jobs.repo.find({
            where: { applicationId: a.id },
            order: { createdAt: 'ASC' },
          })
        ).map(exportJob),
      })),
    );

    const dbs = await this.databases.repo.find({
      where: { projectId: project.id },
      order: { createdAt: 'ASC' },
    });
    const databases = await Promise.all(
      dbs.map(async (d) => ({
        name: d.name,
        slug: d.slug,
        engine: d.engine,
        imageTag: d.imageTag,
        databaseName: d.databaseName,
        username: d.username,
        password: includeSecrets ? await this.databases.password(d) : null,
        hostPort: d.hostPort,
        cpuMillicores: d.cpuMillicores,
        memoryMb: d.memoryMb,
        backupCron: d.backupCron,
        backupKeep: d.backupKeep,
        backupAllDatabases: d.backupAllDatabases,
        references: {
          backupDestination: ref(destinationNames, d.backupDestinationId),
        },
        mounts: (
          await this.databases.mounts.find({
            where: { databaseId: d.id },
            order: { createdAt: 'ASC' },
          })
        ).map(exportMount),
        jobs: (
          await this.jobs.repo.find({
            where: { databaseId: d.id },
            order: { createdAt: 'ASC' },
          })
        ).map(exportJob),
      })),
    );

    const stacks = await this.compose.repo.find({
      where: { projectId: project.id },
      order: { createdAt: 'ASC' },
    });
    const composeApps = await Promise.all(
      stacks.map(async (c) => ({
        name: c.name,
        slug: c.slug,
        source: c.source,
        templateId: c.templateId,
        composeContent: c.composeContent,
        gitUrl: c.gitUrl,
        gitBranch: c.gitBranch,
        composePath: c.composePath,
        env: c.env,
        serviceDomains: c.serviceDomains,
        servicePorts: c.servicePorts,
        references: {
          gitCredential: ref(credentialNames, c.gitCredentialId),
        },
        jobs: (
          await this.jobs.repo.find({
            where: { composeAppId: c.id },
            order: { createdAt: 'ASC' },
          })
        ).map(exportJob),
      })),
    );

    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      includesSecrets: includeSecrets,
      project: {
        name: project.name,
        description: project.description,
        env: project.env,
      },
      applications,
      databases,
      composeApps,
    };
  }
}

function exportMount(m: Mount): ExportedMount {
  return {
    type: m.type,
    name: m.name,
    hostPath: m.hostPath,
    content: m.content,
    containerPath: m.containerPath,
    readOnly: m.readOnly,
  };
}

function exportJob(j: Job): ExportedJob {
  return {
    name: j.name,
    cron: j.cron,
    command: j.command,
    target: j.target,
    enabled: j.enabled,
    timeoutSeconds: j.timeoutSeconds,
    ...(j.service ? { service: j.service } : {}),
  };
}
