import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectService } from '../project.service';

export class ProjectSummaryDto {
  total: number;
  /** Projects with at least one running application, database or compose stack. */
  active: number;
  /** The rest: everything stopped/errored, or nothing deployed yet. */
  inactive: number;
}

/** Dashboard counters. Must come before `GET /projects/:id` in the router order. */
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectSummaryController {
  constructor(private readonly projects: ProjectService) {}

  @Get('summary')
  async summary(@CurrentUser() user: JwtPayload): Promise<ProjectSummaryDto> {
    // A project is "active" when something in it is running; status columns
    // are what aoox last observed, so no Docker call is needed here.
    const ids = await this.projects.access.accessibleProjectIds(user.sub);
    const [row] = await this.projects.repo.query<
      { total: string; active: string }[]
    >(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE
                EXISTS (SELECT 1 FROM applications a WHERE a.project_id = p.id AND a.status = 'running')
                OR EXISTS (SELECT 1 FROM managed_databases d WHERE d.project_id = p.id AND d.status = 'running')
                OR EXISTS (SELECT 1 FROM compose_apps c WHERE c.project_id = p.id AND c.status = 'running')
              ) AS active
       FROM projects p
       WHERE $1::boolean OR p.id = ANY($2::uuid[])`,
      [ids === 'all', ids === 'all' ? [] : ids],
    );
    const total = Number(row?.total ?? 0);
    const active = Number(row?.active ?? 0);
    return { total, active, inactive: total - active };
  }
}
