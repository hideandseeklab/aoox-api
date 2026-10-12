import { Injectable } from '@nestjs/common';
import { Project } from '../project.entity';
import { ProjectEnvironmentService } from '../project-environment.service';
import { ProjectService } from '../project.service';
import { CreateProjectDto } from './create-project.dto';

@Injectable()
export class CreateProjectService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly environments: ProjectEnvironmentService,
  ) {}

  async execute(ownerId: string, dto: CreateProjectDto): Promise<Project> {
    const project = this.projectService.repo.create({
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      ownerId,
    });
    const saved = await this.projectService.repo.save(project);
    // development, staging and production (protected) for every new project.
    await this.environments.ensureDefaults(saved.id);
    return saved;
  }
}
