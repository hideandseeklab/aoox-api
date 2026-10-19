import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { hideEnv } from '../../project/env-visibility';
import { ProjectService } from '../../project/project.service';
import { ApplicationService } from '../application.service';
import { Domain } from '../domain.entity';
import { ApplicationListItemDto } from './list-applications.dto';

@Injectable()
export class ListApplicationsService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly projects: ProjectService,
    @InjectRepository(Domain) private readonly domains: Repository<Domain>,
  ) {}

  async execute(
    ownerId: string,
    projectId: string,
  ): Promise<ApplicationListItemDto[]> {
    const project = await this.projects.findOwnedOrFail(projectId, ownerId);
    const canRead = await this.projects.access.canReadSecrets(ownerId, project);
    const apps = await this.applications.repo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    // One query for every app's domains (not one per card).
    const rows = apps.length
      ? await this.domains.find({
          where: { applicationId: In(apps.map((a) => a.id)) },
          order: { createdAt: 'ASC' },
        })
      : [];
    const byApp = new Map<string, { host: string; https: boolean }[]>();
    for (const d of rows) {
      const list = byApp.get(d.applicationId) ?? [];
      list.push({ host: d.host, https: d.https });
      byApp.set(d.applicationId, list);
    }
    return apps.map((app) => ({
      ...hideEnv(app, canRead),
      domains: byApp.get(app.id) ?? [],
    }));
  }
}
