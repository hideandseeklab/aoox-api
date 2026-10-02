import { Injectable } from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import {
  COMPOSE_PROJECT_PREFIX,
  MonitoringService,
} from '../../monitoring/monitoring.service';
import { ContainerMetrics } from '../../monitoring/container-metrics';
import { ProjectService } from '../project.service';
import {
  buildProjectUsage,
  ProjectResourceUsage,
} from './project-resource-usage.util';

interface ComposeOwnerRow {
  id: string;
  slug: string;
  project_id: string;
}

/**
 * Groups the containers `MonitoringService` already samples every 15s by the
 * project that owns them, and sums each project's containers into one
 * reading — live only, from the in-memory cache (no new Docker calls per
 * request, no stored history: see AGENTS.md → Monitoring → "Resource usage
 * per project" for why).
 */
@Injectable()
export class ProjectResourceUsageService {
  constructor(
    private readonly docker: DockerService,
    private readonly monitoring: MonitoringService,
    private readonly projectService: ProjectService,
  ) {}

  async usageForProject(
    projectId: string,
  ): Promise<ProjectResourceUsage | null> {
    const byProject = await this.usageByProject([projectId]);
    return byProject.get(projectId) ?? null;
  }

  /** One Docker listContainers pair + one compose_apps lookup for every project, not one per project. */
  async usageByProject(
    projectIds: string[],
  ): Promise<Map<string, ProjectResourceUsage>> {
    const result = new Map<string, ProjectResourceUsage>();
    if (projectIds.length === 0) return result;
    const wanted = new Set(projectIds);
    const containerProject = await this.containerProjectMap();
    const containersByProject = new Map<string, string[]>();
    for (const [containerId, projectId] of containerProject) {
      if (!wanted.has(projectId)) continue;
      containersByProject.set(projectId, [
        ...(containersByProject.get(projectId) ?? []),
        containerId,
      ]);
    }
    for (const [projectId, containerIds] of containersByProject) {
      const series = containerIds
        .map((id) => this.monitoring.metricsFor(id))
        .filter(
          (
            m,
          ): m is { current: ContainerMetrics; history: ContainerMetrics[] } =>
            m !== null,
        );
      const usage = buildProjectUsage(series);
      if (usage) result.set(projectId, usage);
    }
    return result;
  }

  /**
   * containerId -> project id, resolved from `aoox.*` labels — no DB query
   * for application/database containers (they carry `aoox.project` directly,
   * see deployment-runner.service.ts / managed-database.service.ts). Compose
   * containers don't carry a project label (compose-runner.service.ts's
   * override only stamps `aoox.component`/`aoox.compose`), so those — and
   * "bare" stacks with no override at all, recognised the same way
   * MonitoringService.sampleAll() does by `com.docker.compose.project` —
   * are resolved with a single compose_apps lookup by id/slug. Mirrors
   * MetricRetentionService.ownersByContainer(), one level further (project
   * instead of application/database/compose).
   */
  private async containerProjectMap(): Promise<Map<string, string>> {
    const [managed, composed] = await Promise.all([
      this.docker.engine.listContainers({
        label: ['aoox.component'],
        status: ['running'],
      }),
      this.docker.engine.listContainers({
        label: ['com.docker.compose.project'],
        status: ['running'],
      }),
    ]);
    const bareCompose = composed.filter(
      (c) =>
        !c.Labels?.['aoox.component'] &&
        c.Labels?.['com.docker.compose.project']?.startsWith(
          COMPOSE_PROJECT_PREFIX,
        ),
    );
    const containers = [...managed, ...bareCompose];

    const map = new Map<string, string>();
    // Containers on remote servers, as captured by the remote sampler (their
    // labels carry the project too); no SSH call per request.
    for (const c of this.monitoring.remoteContainers()) {
      const project = c.labels['aoox.project'];
      if (project) map.set(c.containerId, project);
    }
    const composeIds = new Set<string>();
    const composeSlugs = new Set<string>();
    for (const c of containers) {
      const project = c.Labels?.['aoox.project'];
      if (project) {
        map.set(c.Id, project);
        continue;
      }
      const composeId = c.Labels?.['aoox.compose'];
      if (composeId) {
        composeIds.add(composeId);
        continue;
      }
      const composeProject = c.Labels?.['com.docker.compose.project'];
      if (composeProject?.startsWith(COMPOSE_PROJECT_PREFIX)) {
        composeSlugs.add(composeProject.slice(COMPOSE_PROJECT_PREFIX.length));
      }
    }

    if (composeIds.size === 0 && composeSlugs.size === 0) return map;

    const rows = await this.projectService.repo.query<ComposeOwnerRow[]>(
      `SELECT id, slug, project_id FROM compose_apps
        WHERE id = ANY($1::uuid[]) OR slug = ANY($2::text[])`,
      [[...composeIds], [...composeSlugs]],
    );
    const projectByComposeId = new Map(rows.map((r) => [r.id, r.project_id]));
    const projectBySlug = new Map(rows.map((r) => [r.slug, r.project_id]));
    for (const c of containers) {
      if (map.has(c.Id)) continue;
      const composeId = c.Labels?.['aoox.compose'];
      const viaId = composeId ? projectByComposeId.get(composeId) : undefined;
      if (viaId) {
        map.set(c.Id, viaId);
        continue;
      }
      const composeProject = c.Labels?.['com.docker.compose.project'];
      if (composeProject?.startsWith(COMPOSE_PROJECT_PREFIX)) {
        const slug = composeProject.slice(COMPOSE_PROJECT_PREFIX.length);
        const viaSlug = projectBySlug.get(slug);
        if (viaSlug) map.set(c.Id, viaSlug);
      }
    }
    return map;
  }
}
