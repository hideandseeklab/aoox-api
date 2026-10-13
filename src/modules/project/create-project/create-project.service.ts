import { Injectable } from '@nestjs/common';
import { Project } from '../project.entity';
import { ProjectService } from '../project.service';
import { CreateProjectDto } from './create-project.dto';

@Injectable()
export class CreateProjectService {
  constructor(private readonly projectService: ProjectService) {}

  /** Variables live in variable sets now; a new project starts with none shared. */
  async execute(ownerId: string, dto: CreateProjectDto): Promise<Project> {
    const project = this.projectService.repo.create({
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      ownerId,
    });
    return this.projectService.repo.save(project);
  }
}
