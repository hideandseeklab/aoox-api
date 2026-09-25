import { Injectable } from '@nestjs/common';
import { ProjectService } from '../project.service';

@Injectable()
export class DeleteProjectService {
  constructor(private readonly projectService: ProjectService) {}

  async execute(ownerId: string, id: string): Promise<void> {
    const project = await this.projectService.findOwnedOrFail(id, ownerId);
    // Deleting takes every app/database with it: project admins only.
    await this.projectService.access.assertAdmin(ownerId, project);
    await this.projectService.repo.remove(project);
  }
}
