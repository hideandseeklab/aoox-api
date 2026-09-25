import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Application } from './application.entity';
import { Deployment } from './deployment.entity';
import { Domain } from './domain.entity';
import { Mount } from './mount.entity';
import { ProjectAccessService } from '../project/project-access.service';

/** Names of the Docker objects aoox creates for an application. */
export function containerNameFor(app: Application): string {
  return `aoox-app-${app.appName}`;
}

@Injectable()
export class ApplicationService {
  constructor(
    @InjectRepository(Application)
    readonly repo: Repository<Application>,
    @InjectRepository(Deployment)
    readonly deployments: Repository<Deployment>,
    @InjectRepository(Domain)
    readonly domains: Repository<Domain>,
    @InjectRepository(Mount)
    readonly mounts: Repository<Mount>,
    private readonly access: ProjectAccessService,
  ) {}

  /** Ownership is enforced through the parent project. */
  async findOwnedOrFail(id: string, ownerId: string): Promise<Application> {
    const app = await this.repo.findOne({
      where: { id },
      relations: { project: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    await this.access.assertAccess(ownerId, app.project);
    return app;
  }

  /** `my app` -> `my-app-x7k2q9` */
  static slugify(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'app';
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${base}-${suffix}`;
  }
}
