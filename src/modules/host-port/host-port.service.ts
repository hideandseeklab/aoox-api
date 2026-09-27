import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { DockerHandle } from '../docker/docker.service';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import {
  hostPortConflicts,
  HostPortConflictOptions,
} from './host-port-conflicts';

/**
 * Shared by application (create/update) and compose (update-compose-app,
 * create-from-template) so a host port claimed by one flow is rejected by
 * the others up front, instead of failing silently when the container
 * actually tries to bind it. Only entity classes are imported here (not
 * ApplicationModule/ComposeModule/ManagedDatabaseModule) so this module can
 * be imported by both application and compose without a cycle.
 */
@Injectable()
export class HostPortService {
  constructor(
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(ManagedDatabase)
    private readonly databases: Repository<ManagedDatabase>,
    @InjectRepository(ComposeApp)
    private readonly composeApps: Repository<ComposeApp>,
  ) {}

  /**
   * `docker` is the daemon to check current container bindings against —
   * the local daemon for host apps/stacks, or the target server's handle
   * (`RemoteDockerService.forServer`) for an app deployed remotely. The
   * platform-table checks (applications/managed_databases/compose stacks)
   * are always global, regardless of which daemon `docker` points to.
   */
  async assertFree(
    ports: number[],
    docker: DockerHandle,
    options: HostPortConflictOptions = {},
  ): Promise<void> {
    const seen = new Set(ports);
    if (seen.size === 0) return;
    const uniquePorts = [...seen];
    const [apps, dbs, stacks, containers] = await Promise.all([
      this.applications.find({
        where: uniquePorts.map((hostPort) => ({ hostPort })),
        select: { id: true, appName: true, hostPort: true },
      }),
      this.databases.find({
        where: uniquePorts.map((hostPort) => ({ hostPort })),
        select: { name: true, hostPort: true },
      }),
      this.composeApps.find({
        select: { id: true, name: true, servicePorts: true },
      }),
      docker.engine.listContainers({ status: ['running'] }).catch(() => []),
    ]);
    const conflicts = hostPortConflicts(
      uniquePorts,
      {
        // The `where` clause already filtered to these exact ports, so
        // `hostPort` is never null here despite the entity's nullable type.
        apps: apps.map((a) => ({
          id: a.id,
          appName: a.appName,
          hostPort: a.hostPort as number,
        })),
        dbs: dbs.map((d) => ({ name: d.name, hostPort: d.hostPort as number })),
        stacks,
        containers,
      },
      options,
    );
    if (conflicts.length) {
      throw new BadRequestException(
        `Host port sudah dipakai: ${conflicts.join(', ')}`,
      );
    }
  }
}
