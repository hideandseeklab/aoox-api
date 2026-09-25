import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ApplicationService } from '../application/application.service';
import { ManagedDatabaseService } from '../managed-database/managed-database.service';
import { ContainerSummary } from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import { ProjectAccessService } from '../project/project-access.service';
import { ComposeApp } from './compose-app.entity';

/** Compose project name: the label Docker Desktop groups containers by. */
export function composeProjectFor(app: ComposeApp): string {
  return `aoox-${app.slug}`;
}

/** Named volume holding the checkout between runs. */
export function composeVolumeFor(app: ComposeApp): string {
  return `aoox_compose_${app.slug.replace(/-/g, '_')}`;
}

export interface ComposeContainer {
  id: string;
  name: string;
  service: string;
  state: string;
  status: string;
}

@Injectable()
export class ComposeService {
  constructor(
    @InjectRepository(ComposeApp)
    readonly repo: Repository<ComposeApp>,
    private readonly docker: DockerService,
    private readonly applications: ApplicationService,
    private readonly databases: ManagedDatabaseService,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Docker would only report a bind conflict at `up` time — and by then the
   * old container is already recreated, so the service is down. Check the
   * platform's own port owners (applications, managed databases, other
   * stacks — even when stopped, they will want the port back) and whatever
   * the local daemon currently has bound (containers outside aoox).
   */
  async assertHostPortsFree(app: ComposeApp): Promise<void> {
    const seen = new Set<number>();
    for (const { hostPort } of app.servicePorts) {
      if (seen.has(hostPort)) {
        throw new BadRequestException(
          `Host port ${hostPort} is listed more than once`,
        );
      }
      seen.add(hostPort);
    }
    if (seen.size === 0) return;
    const ports = [...seen];
    const [apps, dbs, stacks, containers] = await Promise.all([
      this.applications.repo.find({
        where: ports.map((hostPort) => ({ hostPort })),
        select: { appName: true, hostPort: true },
      }),
      this.databases.repo.find({
        where: ports.map((hostPort) => ({ hostPort })),
        select: { name: true, hostPort: true },
      }),
      this.repo.find({
        where: { id: Not(app.id) },
        select: { name: true, servicePorts: true },
      }),
      this.docker.engine
        .listContainers({ status: ['running'] })
        .catch(() => []),
    ]);
    // A Set: the daemon lists one entry per bound IP (IPv4 and IPv6).
    const taken = new Set<string>();
    for (const a of apps) taken.add(`${a.hostPort} (aplikasi ${a.appName})`);
    for (const d of dbs) taken.add(`${d.hostPort} (database ${d.name})`);
    for (const s of stacks) {
      for (const p of s.servicePorts) {
        if (seen.has(p.hostPort)) taken.add(`${p.hostPort} (stack ${s.name})`);
      }
    }
    // This stack's own containers are recreated on deploy, so their current
    // bindings do not count.
    const own = composeProjectFor(app);
    for (const c of containers) {
      if (c.Labels?.['com.docker.compose.project'] === own) continue;
      for (const p of c.Ports ?? []) {
        if (p.PublicPort && seen.has(p.PublicPort)) {
          taken.add(
            `${p.PublicPort} (container ${c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12)})`,
          );
        }
      }
    }
    if (taken.size) {
      throw new BadRequestException(
        `Host port sudah dipakai: ${[...taken].join(', ')}`,
      );
    }
  }

  /** Ownership is enforced through the parent project. */
  async findOwnedOrFail(id: string, ownerId: string): Promise<ComposeApp> {
    const app = await this.repo.findOne({
      where: { id },
      relations: { project: true },
    });
    if (!app) throw new NotFoundException('Compose app not found');
    await this.access.assertAccess(ownerId, app.project);
    return app;
  }

  /** Containers of the stack, via the label the compose CLI sets itself. */
  async containers(app: ComposeApp): Promise<ComposeContainer[]> {
    let list: ContainerSummary[];
    try {
      list = await this.docker.engine.listContainers({
        label: [`com.docker.compose.project=${composeProjectFor(app)}`],
      });
    } catch {
      return [];
    }
    return list
      .map((c) => ({
        id: c.Id,
        name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
        service: c.Labels?.['com.docker.compose.service'] ?? '',
        state: c.State,
        status: c.Status,
      }))
      .sort((a, b) => a.service.localeCompare(b.service));
  }

  /** `my stack` -> `my-stack-x7k2q9` */
  static slugify(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'stack';
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base}-${suffix}`;
  }
}
