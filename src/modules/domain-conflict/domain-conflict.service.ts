import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { DockerHandle } from '../docker/docker.service';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import {
  containerName,
  KnownOwners,
  orphanedContainers,
} from '../maintenance/orphan-containers';
import { claimsOnHosts } from './traefik-hosts';

/** Another container that already routes a host; never blocks anything. */
export interface DomainConflict {
  containerName: string;
  containerId: string;
  /** Left over from a deleted project/app (removable in Settings > Disk). */
  orphan: boolean;
}

/** `aoox-app-<appName>` is also what `containerNameFor` produces. */
function ownName(app: Pick<Application, 'appName'>): string {
  return `aoox-app-${app.appName}`;
}

/**
 * Finds containers on a daemon that already carry a Traefik router for a
 * host, so the Domain tab can warn before two routers with equal priority
 * split the traffic. Only entity classes are used here so application and
 * maintenance can both import this module without a cycle.
 */
@Injectable()
export class DomainConflictService {
  private readonly logger = new Logger(DomainConflictService.name);

  constructor(
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(ManagedDatabase)
    private readonly databases: Repository<ManagedDatabase>,
    @InjectRepository(ComposeApp)
    private readonly composeApps: Repository<ComposeApp>,
  ) {}

  /** Ids of every row that can own a container (the orphan decision input). */
  async knownOwners(): Promise<KnownOwners> {
    const [apps, dbs, stacks] = await Promise.all([
      this.applications.find({ select: { id: true } }),
      this.databases.find({ select: { id: true } }),
      this.composeApps.find({ select: { id: true, slug: true } }),
    ]);
    return {
      applications: new Set(apps.map((a) => a.id)),
      databases: new Set(dbs.map((d) => d.id)),
      composeApps: new Set(stacks.map((s) => s.id)),
      composeSlugs: new Set(stacks.map((s) => s.slug)),
    };
  }

  /**
   * One `listContainers` for all `hosts`. `local` = the daemon is the aoox
   * host: only then can a leftover be removed from the Disk card, so only
   * then is `orphan` ever true. Never throws (an unreachable daemon means
   * "no known conflicts").
   */
  async find(
    docker: DockerHandle,
    app: Pick<Application, 'id' | 'appName'>,
    hosts: string[],
    local: boolean,
  ): Promise<Map<string, DomainConflict[]>> {
    const empty = new Map<string, DomainConflict[]>(
      hosts.map((h) => [h.toLowerCase(), []]),
    );
    if (hosts.length === 0) return empty;
    try {
      const containers = await docker.engine.listContainers();
      const own = ownName(app);
      const claims = claimsOnHosts(containers, hosts, (c) => {
        const name = containerName(c);
        return (
          c.Labels?.['aoox.application'] === app.id ||
          name === own ||
          name === `${own}-next`
        );
      });
      const orphanIds = new Set<string>();
      if (local && [...claims.values()].some((v) => v.length > 0)) {
        for (const o of orphanedContainers(
          containers,
          await this.knownOwners(),
        )) {
          orphanIds.add(o.id);
        }
      }
      for (const [host, list] of claims) {
        empty.set(
          host,
          list.map((c) => ({
            containerName: containerName(c),
            containerId: c.Id,
            orphan: orphanIds.has(c.Id),
          })),
        );
      }
    } catch (err) {
      this.logger.warn(`Domain conflict check failed: ${String(err)}`);
    }
    return empty;
  }
}
