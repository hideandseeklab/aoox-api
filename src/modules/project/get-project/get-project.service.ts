import { Injectable } from '@nestjs/common';
import { Project } from '../project.entity';
import { ProjectService } from '../project.service';

@Injectable()
export class GetProjectService {
  constructor(private readonly projectService: ProjectService) {}

  execute(ownerId: string, id: string): Promise<Project> {
    return this.projectService.findOwnedOrFail(id, ownerId);
  }
}
