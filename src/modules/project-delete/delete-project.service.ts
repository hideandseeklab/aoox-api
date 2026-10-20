import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { ApplicationService } from '../application/application.service';
import { DeleteApplicationService } from '../application/delete-application/delete-application.service';
import { builtRepositoriesFor } from '../application/built-repositories';
import { filesVolumeFor, volumeNameFor } from '../application/mounts';
import { ComposeApp } from '../compose/compose-app.entity';
import { ComposeRunnerService } from '../compose/compose-runner.service';
import { BackupPurgeService } from '../backup-purge/backup-purge.service';
import { BackupSchedulerService } from '../database-backup/backup-scheduler.service';
import { DockerEngineError } from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import { JobSchedulerService } from '../job/job-scheduler.service';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { DeleteRepositoryService } from '../registry/delete-repository/delete-repository.service';
import { ProjectService } from '../project/project.service';
import { VolumeBackupSchedulerService } from '../volume-backup/volume-backup-scheduler.service';

/**
 * Deletes a project together with everything running for it. The FK cascade
 * only removes rows; containers (and the Traefik labels they carry) would keep
 * serving the project's domains, so each workload is torn down first, reusing
 * the single-resource cleanup:
 *
 *   compose stacks -> applications -> databases -> project row
 *
 * Each resource's row is removed right after its own cleanup. If one fails
 * (typically the Docker daemon or a remote server is unreachable) the delete
 * stops with a 502 naming it, and the project plus whatever was not reached
 * stay, so retrying resumes where it stopped. `purge` also deletes the data
 * volumes, the backup files and their S3 copies, and the repositories aoox built for the applications in the self-hosted registry; without it they stay and show up as orphan volumes in the Disk card.
 */
@Injectable()
export class DeleteProjectService {
  private readonly logger = new Logger(DeleteProjectService.name);

  constructor(
    private readonly projectService: ProjectService,
    private readonly applications: ApplicationService,
    private readonly deleteApplication: DeleteApplicationService,
    private readonly databases: ManagedDatabaseService,
    private readonly composeRunner: ComposeRunnerService,
    private readonly docker: DockerService,
    private readonly jobScheduler: JobSchedulerService,
    private readonly backupScheduler: BackupSchedulerService,
    private readonly volumeScheduler: VolumeBackupSchedulerService,
    private readonly backupPurge: BackupPurgeService,
    private readonly registryPurge: DeleteRepositoryService,
    @InjectRepository(Application)
    private readonly appRepo: Repository<Application>,
    @InjectRepository(ManagedDatabase)
    private readonly dbRepo: Repository<ManagedDatabase>,
    @InjectRepository(ComposeApp)
    private readonly composeRepo: Repository<ComposeApp>,
  ) {}

  async execute(ownerId: string, id: string, purge = false): Promise<void> {
    const project = await this.projectService.findOwnedOrFail(id, ownerId);
    // Deleting takes every app/database with it: project admins only.
    await this.projectService.access.assertAdmin(ownerId, project);

    const stacks = await this.composeRepo.find({ where: { projectId: id } });
    const busy = stacks.find((s) => this.composeRunner.isActive(s.id));
    if (busy) {
      throw new ConflictException(
        `A compose action is still running for "${busy.name}"`,
      );
    }
    const apps = await this.appRepo.find({ where: { projectId: id } });
    const dbs = await this.dbRepo.find({ where: { projectId: id } });
    const starting = dbs.find((d) => d.status === 'creating');
    if (starting) {
      throw new ConflictException(
        `The database "${starting.name}" is still starting. Try again in a moment.`,
      );
    }

    const destroyed: Application[] = [];
    try {
      for (const stack of stacks) {
        await this.step(`stack "${stack.name}"`, async () => {
          await this.composeRunner.destroy(stack, { keepVolumes: !purge });
          if (purge) await this.purgeMountVolumes(stack);
          await this.composeRepo.remove(stack);
        });
      }
      for (const app of apps) {
        // Throws its own 502 naming the application.
        await this.deleteApplication.destroy(app, { purge });
        destroyed.push(app);
      }
      for (const db of dbs) {
        await this.step(`database "${db.name}"`, async () => {
          await this.databases.remove(db, purge);
          if (purge) await this.backupPurge.purgeDatabase(db.id);
          await this.dbRepo.remove(db);
        });
      }
    } finally {
      // Images aoox built for the applications that are gone (best effort).
      if (purge) {
        const repositories = destroyed.flatMap((a) =>
          builtRepositoriesFor(project.name, a),
        );
        await this.registryPurge
          .purgeRepositories(repositories)
          .catch((err: unknown) =>
            this.logger.warn(`Registry purge failed: ${String(err)}`),
          );
      }
      // Cron entries of what is gone (jobs, backups) must not outlive it.
      await Promise.all([
        this.jobScheduler.reloadAll(),
        this.backupScheduler.reloadAll(),
        this.volumeScheduler.reloadAll(),
      ]).catch((err) =>
        this.logger.warn(`Scheduler reload failed: ${String(err)}`),
      );
    }
    await this.projectService.repo.remove(project);
  }

  /** Runs one cleanup and turns a plain failure into a 502 that names the resource. */
  private async step(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadGatewayException(
        `Could not remove ${label}: ${err instanceof Error ? err.message : String(err)}. The project was kept; try again once the Docker daemon is reachable.`,
      );
    }
  }

  /**
   * Named volumes of a stack's `volume` mounts and the shared files volume (a
   * database's are removed by `ManagedDatabaseService.remove`). They are
   * created by aoox and mounted into containers (for stacks as `external`),
   * so neither a container removal nor `compose down --volumes` drops them.
   */
  private async purgeMountVolumes(owner: ComposeApp): Promise<void> {
    const mounts = await this.applications.mounts.find({
      where: { composeAppId: owner.id },
    });
    const mountOwner = { slug: owner.slug };
    const names = [
      ...mounts
        .filter((m) => m.type === 'volume')
        .map((m) => volumeNameFor(mountOwner, m)),
      filesVolumeFor(mountOwner),
    ];
    for (const n of names) {
      await this.docker.engine.removeVolume(n).catch((err: unknown) => {
        if (err instanceof DockerEngineError && err.status === 404) return;
        throw err;
      });
    }
  }
}
