import { Injectable } from '@nestjs/common';
import { ProjectService } from '../../project/project.service';
import { Application } from '../application.entity';
import { ApplicationService } from '../application.service';

@Injectable()
export class ListApplicationsService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly projects: ProjectService,
  ) {}

  async execute(ownerId: string, projectId: string): Promise<Application[]> {
    await this.projects.findOwnedOrFail(projectId, ownerId);
    return this.applications.repo.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }
}
