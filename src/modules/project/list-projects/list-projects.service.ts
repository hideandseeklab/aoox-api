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
  /**
   * A build/redeploy is in flight right now: application = an active row in
   * `deployments` (`queued`/`building`/`pushing`/`starting`); database =
   * `creating`; compose = `status === 'deploying'`. Lets overview cards show
   * a live "deploying…" badge without a Docker call.
   */
  deploying: boolean;
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
      `SELECT 'application' AS kind, a.id, a.name, a.status, NULL AS engine, a.project_id AS "projectId",
              a.created_at,
              EXISTS (
                SELECT 1 FROM deployments d
                WHERE d.application_id = a.id
                  AND d.status IN ('queued', 'building', 'pushing', 'starting')
              ) AS deploying
         FROM applications a WHERE a.project_id = ANY($1)
       UNION ALL
       SELECT 'database', id, name, status, engine, project_id, created_at, status = 'creating'
         FROM managed_databases WHERE project_id = ANY($1)
       UNION ALL
       SELECT 'compose', id, name, status, NULL, project_id, created_at, status = 'deploying'
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
