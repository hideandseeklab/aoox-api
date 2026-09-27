import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContainerSummary } from '../docker/docker-engine.client';
import { DockerService } from '../docker/docker.service';
import { HostPortService } from '../host-port/host-port.service';
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
    private readonly hostPorts: HostPortService,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Duplicate-within-request check is compose-specific (one stack can list
   * the same port for two services by mistake); the rest — platform-table
   * owners and the daemon's current bindings — is shared with application
   * create/update via `HostPortService` (see `src/modules/host-port/`).
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
    // This stack's own containers are recreated on deploy, so their current
    // bindings do not count.
    const own = composeProjectFor(app);
    await this.hostPorts.assertFree([...seen], this.docker, {
      excludeComposeAppId: app.id,
      isOwnContainer: (c: ContainerSummary) =>
        c.Labels?.['com.docker.compose.project'] === own,
    });
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
