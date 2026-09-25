import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAccessService } from './project-access.service';
import { Project } from './project.entity';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    readonly repo: Repository<Project>,
    readonly access: ProjectAccessService,
  ) {}

  /**
   * Finds a project the actor may see, or throws 404 (also when it exists
   * but they are not a member — see ProjectAccessService). `ownerId` is the
   * acting user's id; every child resource's `findOwnedOrFail` ends up here.
   */
  async findOwnedOrFail(id: string, ownerId: string): Promise<Project> {
    const project = await this.repo.findOne({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    await this.access.assertAccess(ownerId, project);
    return project;
  }
}
