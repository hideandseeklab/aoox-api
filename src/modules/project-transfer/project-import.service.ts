import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { normalizePath } from '../application/add-mount/add-mount.service';
import { ApplicationService } from '../application/application.service';
import { Mount } from '../application/mount.entity';
import { BackupDestinationService } from '../backup-destination/backup-destination.service';
import { ComposeService } from '../compose/compose.service';
import { BackupSchedulerService } from '../database-backup/backup-scheduler.service';
import { GitCredentialService } from '../git-credential/git-credential.service';
import { JobSchedulerService } from '../job/job-scheduler.service';
import { Job } from '../job/job.entity';
import { JobService } from '../job/job.service';
import { ENGINES } from '../managed-database/engines';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { ProjectService } from '../project/project.service';
import { RegistryService } from '../registry/registry.service';
import { ServerService } from '../server/server.service';
import { VolumeBackupSchedulerService } from '../volume-backup/volume-backup-scheduler.service';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ExportedJob,
  ExportedMount,
  ImportReport,
  ProjectExport,
} from './project-export.types';

export interface ImportOptions {
  /** Overrides `project.name` from the file. */
  name?: string;
  /** Role of the importing user; bind mounts need owner/admin (like add-mount). */
  role: string;
  ownerId: string;
}

/**
 * Creates a new project from a `ProjectExport`. Nothing is deployed: apps
 * come back `idle` without an image, databases are provisioned (empty) in
 * the background like `create-database`, compose stacks stay `idle`.
 * Platform references are matched by name; anything unmatched is left
 * empty and reported in `warnings`, never a hard error, so a file from
 * another instance still imports.
 */
@Injectable()
export class ProjectImportService {
  constructor(
    private readonly projects: ProjectService,
    private readonly applications: ApplicationService,
    private readonly databases: ManagedDatabaseService,
    private readonly compose: ComposeService,
    private readonly jobs: JobService,
    private readonly jobScheduler: JobSchedulerService,
    private readonly backupScheduler: BackupSchedulerService,
    private readonly volumeBackupScheduler: VolumeBackupSchedulerService,
    private readonly registries: RegistryService,
    private readonly credentials: GitCredentialService,
    private readonly destinations: BackupDestinationService,
    private readonly servers: ServerService,
  ) {}

  async import(file: unknown, options: ImportOptions): Promise<ImportReport> {
    validateShape(file);
    const warnings: string[] = [];
    const created = {
      applications: 0,
      databases: 0,
      composeApps: 0,
      domains: 0,
      mounts: 0,
      jobs: 0,
    };

    // Name → id maps for references (a handful of rows each).
    const idOf = async <T extends { id: string; name: string }>(
      rows: Promise<T[]>,
    ) => new Map((await rows).map((r) => [r.name, r.id] as const));
    const [registryIds, credentialIds, destinationIds, serverIds] =
      await Promise.all([
        idOf(this.registries.repo.find()),
        idOf(this.credentials.repo.find()),
        idOf(this.destinations.repo.find()),
        idOf(this.servers.repo.find()),
      ]);
    const resolve = (
      kind: string,
      map: Map<string, string>,
      name: string | null | undefined,
      where: string,
    ): string | null => {
      if (!name) return null;
      const id = map.get(name);
      if (!id)
        warnings.push(`${where}: ${kind} "${name}" not found, left empty`);
      return id ?? null;
    };

    const project = await this.projects.repo.save(
      this.projects.repo.create({
        name: (options.name ?? file.project.name).trim(),
        description: file.project.description ?? null,
        env: file.project.env ?? '',
        ownerId: options.ownerId,
      }),
    );

    for (const a of file.applications ?? []) {
      const where = `application "${a.name}"`;
      const appName = await this.freeSlug(
        this.applications.repo,
        'appName',
        a.appName,
        () => ApplicationService.slugify(a.name),
        where,
        warnings,
      );
      const app = await this.applications.repo.save(
        this.applications.repo.create({
          projectId: project.id,
          name: a.name,
          appName,
          sourceType: a.sourceType ?? 'git',
          gitUrl: a.gitUrl ?? null,
          gitBranch: a.gitBranch || 'main',
          imageRef: a.imageRef ?? null,
          imageRegistryId: resolve(
            'registry',
            registryIds,
            a.references?.imageRegistry,
            where,
          ),
          dockerfilePath: a.dockerfilePath || 'Dockerfile',
          buildType: a.buildType ?? 'dockerfile',
          staticBuildCommand: a.staticBuildCommand ?? null,
          staticOutputDir: a.staticOutputDir || 'dist',
          staticSpa: a.staticSpa ?? true,
          containerPort: a.containerPort ?? 3000,
          hostPort: await this.freeHostPort(a.hostPort, where, warnings),
          env: a.env ?? '',
          buildArgs: a.buildArgs ?? '',
          healthcheckPath: a.healthcheckPath ?? null,
          deploymentKeep: a.deploymentKeep ?? 10,
          backupCron: validCron(a.backupCron, where, warnings),
          backupKeep: a.backupKeep ?? 7,
          cpuMillicores: a.cpuMillicores ?? null,
          memoryMb: a.memoryMb ?? null,
          previewsEnabled: a.previewsEnabled ?? false,
          previewDomain: a.previewDomain ?? null,
          gitCredentialId: resolve(
            'git credential',
            credentialIds,
            a.references?.gitCredential,
            where,
          ),
          backupDestinationId: resolve(
            'backup destination',
            destinationIds,
            a.references?.backupDestination,
            where,
          ),
          serverId: resolve('server', serverIds, a.references?.server, where),
          // Never reused across instances; the secret is not exported either.
          webhookToken: randomBytes(24).toString('base64url'),
        }),
      );
      created.applications++;
      for (const d of a.domains ?? []) {
        if (
          await this.applications.domains.findOne({ where: { host: d.host } })
        ) {
          warnings.push(`${where}: domain ${d.host} already in use, skipped`);
          continue;
        }
        await this.applications.domains.save(
          this.applications.domains.create({
            applicationId: app.id,
            host: d.host,
            https: d.https ?? false,
          }),
        );
        created.domains++;
      }
      created.mounts += await this.importMounts(
        this.applications.mounts,
        { applicationId: app.id },
        a.mounts ?? [],
        options.role,
        where,
        warnings,
      );
      created.jobs += await this.importJobs(
        { applicationId: app.id },
        a.jobs ?? [],
        where,
        warnings,
      );
      this.volumeBackupScheduler.reschedule(app);
    }

    for (const d of file.databases ?? []) {
      const where = `database "${d.name}"`;
      const spec = ENGINES[d.engine];
      if (!spec) {
        warnings.push(
          `${where}: unknown engine "${String(d.engine)}", skipped`,
        );
        continue;
      }
      const slug = await this.freeSlug(
        this.databases.repo,
        'slug',
        d.slug,
        () => ManagedDatabaseService.slugify(d.name),
        where,
        warnings,
      );
      const password =
        d.password ||
        randomBytes(18).toString('base64url').replace(/[-_]/g, 'x');
      if (!d.password) {
        warnings.push(`${where}: no password in file, a new one was generated`);
      }
      const db = await this.databases.repo.save(
        this.databases.repo.create({
          projectId: project.id,
          name: d.name,
          slug,
          engine: d.engine,
          imageTag: d.imageTag || spec.defaultTag,
          databaseName: spec.hasDatabase
            ? d.databaseName || slug.replace(/-/g, '_')
            : '',
          username: d.username || (spec.hasDatabase ? 'app' : 'default'),
          passwordEncrypted: this.databases.encrypt(password),
          hostPort: await this.freeHostPort(d.hostPort, where, warnings),
          cpuMillicores: d.cpuMillicores ?? null,
          memoryMb: d.memoryMb ?? null,
          backupCron: validCron(d.backupCron, where, warnings),
          backupKeep: d.backupKeep ?? 7,
          backupAllDatabases: d.backupAllDatabases ?? false,
          backupDestinationId: resolve(
            'backup destination',
            destinationIds,
            d.references?.backupDestination,
            where,
          ),
          status: 'creating',
        }),
      );
      created.databases++;
      created.mounts += await this.importMounts(
        this.databases.mounts,
        { databaseId: db.id },
        d.mounts ?? [],
        options.role,
        where,
        warnings,
      );
      created.jobs += await this.importJobs(
        { databaseId: db.id },
        d.jobs ?? [],
        where,
        warnings,
      );
      this.backupScheduler.reschedule(db);
      // Mounts are read by provision, so they must exist before it starts.
      this.databases.provisionInBackground(db, password);
    }

    for (const c of file.composeApps ?? []) {
      const where = `compose "${c.name}"`;
      const slug = await this.freeSlug(
        this.compose.repo,
        'slug',
        c.slug,
        () => ComposeService.slugify(c.name),
        where,
        warnings,
      );
      const stack = await this.compose.repo.save(
        this.compose.repo.create({
          projectId: project.id,
          name: c.name,
          slug,
          source: c.source ?? 'git',
          templateId: c.templateId ?? null,
          composeContent: c.composeContent ?? null,
          gitUrl: c.gitUrl ?? null,
          gitBranch: c.gitBranch || 'main',
          gitCredentialId: resolve(
            'git credential',
            credentialIds,
            c.references?.gitCredential,
            where,
          ),
          composePath: c.composePath || 'docker-compose.yml',
          env: c.env ?? '',
          serviceDomains: c.serviceDomains ?? [],
          servicePorts: await this.freeServicePorts(
            c.servicePorts ?? [],
            where,
            warnings,
          ),
          status: 'idle',
        }),
      );
      created.composeApps++;
      created.jobs += await this.importJobs(
        { composeAppId: stack.id },
        c.jobs ?? [],
        where,
        warnings,
      );
    }

    return { projectId: project.id, created, warnings };
  }

  /** A host port already published by another app/database here would fail at start. */
  private async freeHostPort(
    port: number | null | undefined,
    where: string,
    warnings: string[],
  ): Promise<number | null> {
    if (!port) return null;
    const [app, db, stacks] = await Promise.all([
      this.applications.repo.findOne({ where: { hostPort: port } }),
      this.databases.repo.findOne({ where: { hostPort: port } }),
      this.compose.repo.find({ select: { servicePorts: true } }),
    ]);
    const stack = stacks.some((s) =>
      s.servicePorts.some((p) => p.hostPort === port),
    );
    if (!app && !db && !stack) return port;
    warnings.push(`${where}: host port ${port} already in use, left empty`);
    return null;
  }

  /** Same rule per published stack port: a taken host port is dropped with a warning. */
  private async freeServicePorts<T extends { hostPort: number }>(
    ports: T[],
    where: string,
    warnings: string[],
  ): Promise<T[]> {
    const kept: T[] = [];
    for (const p of ports) {
      if (await this.freeHostPort(p.hostPort, where, warnings)) kept.push(p);
    }
    return kept;
  }

  /** Keeps the exported slug when free (same instance re-import → new one). */
  private async freeSlug<T extends Record<K, string>, K extends string>(
    repo: Repository<T>,
    column: K,
    wanted: string | undefined,
    generate: () => string,
    where: string,
    warnings: string[],
  ): Promise<string> {
    if (wanted && /^[a-z0-9-]{1,64}$/.test(wanted)) {
      const taken = await repo.findOne({
        where: { [column]: wanted } as never,
      });
      if (!taken) return wanted;
      const fresh = generate();
      warnings.push(
        `${where}: ${column} "${wanted}" already exists, renamed to "${fresh}"`,
      );
      return fresh;
    }
    return generate();
  }

  private async importMounts(
    repo: Repository<Mount>,
    owner: Pick<Mount, 'applicationId'> | Pick<Mount, 'databaseId'>,
    mounts: ExportedMount[],
    role: string,
    where: string,
    warnings: string[],
  ): Promise<number> {
    let n = 0;
    for (const m of mounts) {
      if (m.type === 'bind' && role !== 'owner' && role !== 'admin') {
        warnings.push(
          `${where}: bind mount ${m.containerPath} skipped (owner/admin only)`,
        );
        continue;
      }
      if (!['volume', 'bind', 'file'].includes(m.type) || !m.containerPath) {
        warnings.push(`${where}: invalid mount skipped`);
        continue;
      }
      const containerPath = normalizePath(m.containerPath);
      await repo.save(
        repo.create({
          applicationId: null,
          databaseId: null,
          ...owner,
          type: m.type,
          containerPath,
          readOnly: m.type === 'file' ? true : (m.readOnly ?? false),
          name:
            m.type === 'bind'
              ? null
              : m.name || containerPath.split('/').pop() || 'file',
          hostPath: m.type === 'bind' ? normalizePath(m.hostPath ?? '/') : null,
          content: m.type === 'file' ? (m.content ?? '') : null,
        }),
      );
      n++;
    }
    return n;
  }

  private async importJobs(
    owner: Partial<Pick<Job, 'applicationId' | 'databaseId' | 'composeAppId'>>,
    jobs: ExportedJob[],
    where: string,
    warnings: string[],
  ): Promise<number> {
    let n = 0;
    for (const j of jobs) {
      if (!j.name || !j.command) {
        warnings.push(`${where}: job without name/command skipped`);
        continue;
      }
      let job: Job;
      try {
        job = this.jobs.build(
          owner,
          {
            name: j.name,
            cron: j.cron ?? undefined,
            command: j.command,
            target: j.target ?? 'container',
            enabled: j.enabled ?? true,
            timeoutSeconds: j.timeoutSeconds ?? 600,
          },
          owner.composeAppId ? (j.service ?? null) : null,
        );
      } catch (err) {
        warnings.push(
          `${where}: job "${j.name}" skipped (${(err as Error).message})`,
        );
        continue;
      }
      const saved = await this.jobs.repo.save(job);
      this.jobScheduler.reschedule(saved);
      n++;
    }
    return n;
  }
}

function validCron(
  cron: string | null | undefined,
  where: string,
  warnings: string[],
): string | null {
  if (!cron) return null;
  if (!BackupSchedulerService.isValidCron(cron)) {
    warnings.push(`${where}: invalid backup cron "${cron}" ignored`);
    return null;
  }
  return cron;
}

/** Structural checks before anything is written; deeper fields fall back to defaults. */
function validateShape(input: unknown): asserts input is ProjectExport {
  const file = input as Record<string, unknown> | null;
  if (!file || typeof file !== 'object') {
    throw new BadRequestException('Import file must be a JSON object');
  }
  if (file.format !== EXPORT_FORMAT) {
    throw new BadRequestException(
      `Unknown format; expected "${EXPORT_FORMAT}"`,
    );
  }
  if (file.version !== EXPORT_VERSION) {
    throw new BadRequestException(
      `Unsupported version ${String(file.version)}; this instance reads version ${EXPORT_VERSION}`,
    );
  }
  const project = file.project as { name?: unknown } | undefined;
  if (typeof project?.name !== 'string' || !project.name.trim()) {
    throw new BadRequestException('project.name is required');
  }
  for (const key of ['applications', 'databases', 'composeApps'] as const) {
    const list = file[key];
    if (list !== undefined && !Array.isArray(list)) {
      throw new BadRequestException(`${key} must be an array`);
    }
    for (const item of (list ?? []) as Array<{ name?: unknown }>) {
      if (!item || typeof item.name !== 'string' || !item.name.trim()) {
        throw new BadRequestException(`every entry in ${key} needs a name`);
      }
    }
  }
}
