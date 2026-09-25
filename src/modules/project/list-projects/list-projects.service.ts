import { Injectable } from '@nestjs/common';
import { ILike } from 'typeorm';
import { Project } from '../project.entity';
import { ProjectService } from '../project.service';
import { ListProjectsDto } from './list-projects.dto';

export type ProjectInstanceKind = 'application' | 'database' | 'compose';

/** One deployable inside a project, for the overview cards. */
export interface ProjectInstanceDto {
  kind: ProjectInstanceKind;
  id: string;
  name: string;
  /** Status column as last observed (`running` = active). */
  status: string;
  /** Engine for databases (postgres/mysql/…); null otherwise. */
  engine: string | null;
}

export type ProjectListItemDto = Project & { instances: ProjectInstanceDto[] };

@Injectable()
export class ListProjectsService {
  constructor(private readonly projectService: ProjectService) {}

  async execute(
    ownerId: string,
    dto: ListProjectsDto,
  ): Promise<ProjectListItemDto[]> {
    const search = dto.search?.trim();
    const projects = await this.projectService.repo.find({
      // Platform owners/admins see everything; members only their projects.
      where: {
        ...(await this.projectService.access.whereAccessible(ownerId)),
        ...(search ? { name: ILike(`%${search}%`) } : {}),
      },
      order: { createdAt: 'DESC' },
    });
    if (projects.length === 0) return [];
    const ids = projects.map((p) => p.id);
    // Raw SQL like the summary counter: ProjectModule cannot import the
    // application/database/compose modules (they import it).
    const rows = await this.projectService.repo.query<
      (ProjectInstanceDto & { projectId: string })[]
    >(
      `SELECT 'application' AS kind, id, name, status, NULL AS engine, project_id AS "projectId", created_at
         FROM applications WHERE project_id = ANY($1)
       UNION ALL
       SELECT 'database', id, name, status, engine, project_id, created_at
         FROM managed_databases WHERE project_id = ANY($1)
       UNION ALL
       SELECT 'compose', id, name, status, NULL, project_id, created_at
         FROM compose_apps WHERE project_id = ANY($1)
       ORDER BY created_at ASC`,
      [ids],
    );
    const byProject = new Map<string, ProjectInstanceDto[]>();
    for (const { projectId, ...instance } of rows) {
      byProject.set(projectId, [...(byProject.get(projectId) ?? []), instance]);
    }
    return projects.map((p) => ({
      ...p,
      instances: byProject.get(p.id) ?? [],
    }));
  }
}
