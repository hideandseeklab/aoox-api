import { Injectable } from '@nestjs/common';
import { Project } from '../project.entity';
import { ProjectService } from '../project.service';
import { UpdateProjectDto } from './update-project.dto';

@Injectable()
export class UpdateProjectService {
  constructor(private readonly projectService: ProjectService) {}

  async execute(
    ownerId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.projectService.findOwnedOrFail(id, ownerId);
    if (dto.name !== undefined) project.name = dto.name.trim();
    if (dto.description !== undefined) {
      project.description = dto.description.trim() || null;
    }
    if (dto.env !== undefined) project.env = dto.env;
    return this.projectService.repo.save(project);
  }
}
