import { Injectable } from '@nestjs/common';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { Application } from '../application.entity';
import { ApplicationService, containerNameFor } from '../application.service';
import { ProjectAccessService } from '../../project/project-access.service';
import type { ProjectRole } from '../../project/project-member.entity';
import { readExposedPorts } from '../exposed-ports';
import { ServiceStatus, SwarmDeployService } from '../swarm-deploy.service';
import { SecretSourceService } from '../../secret-source/secret-source.service';
import {
  SecretSourceView,
  secretSourceView,
} from '../secret-source/secret-source-view';
import type { LinkView } from '../../variable-set/variable-set-link.service';
import { OwnerVariableSetsService } from '../variable-set-links/variable-set-links.service';

export interface ApplicationDetail extends Application {
  /** Live container state from Docker, or null when no container exists. */
  container: { id: string; state: string; status: string } | null;
  /** Swarm service (deployMode 'service'), or null. */
  service: ServiceStatus | null;
  /** The actor's role in the owning project (UI hides what a viewer cannot do). */
  projectRole: ProjectRole;
  /** External secret source (never any credential or value), or null. */
  secretSource: SecretSourceView | null;
  /**
   * TCP ports the image in `currentImage` declares with EXPOSE (read live from
   * the app's daemon); null when unknown: no current image, image not on the
   * daemon, daemon unreachable or slow. [] = the image exposes nothing.
   */
  exposedPorts: number[] | null;
  /** Linked variable set environments in merge order (no values), with per-key conflicts. */
  variableSets: LinkView[];
}

@Injectable()
export class GetApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly access: ProjectAccessService,
    private readonly secrets: SecretSourceService,
    private readonly variableSets: OwnerVariableSetsService,
  ) {}

  async execute(ownerId: string, id: string): Promise<ApplicationDetail> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    const projectRole = (await this.access.roleFor(ownerId, app.project))!;
    const secretSource = secretSourceView(
      app,
      app.secretConnectionId
        ? ((
            await this.secrets.repo.findOne({
              where: { id: app.secretConnectionId },
            })
          )?.name ?? null)
        : null,
    );
    const variableSets = await this.variableSets.views(
      { kind: 'application', id: app.id, projectId: app.projectId },
      app.env,
    );
    if (app.deployMode === 'service') {
      const service = await this.swarmDeploy.status(app).catch(() => null);
      // The "container" summary is what the web renders; derive it from the tasks.
      const container = service
        ? {
            id:
              service.tasks.find((t) => t.state === 'running')?.containerId ??
              service.serviceId,
            state:
              service.running > 0
                ? 'running'
                : service.desired === 0
                  ? 'exited'
                  : (service.updateState ?? 'starting'),
            status: `${service.running}/${service.desired} replicas`,
          }
        : null;
      const exposedPorts = await this.exposedPortsOf(app);
      return {
        ...app,
        container,
        service,
        projectRole,
        secretSource,
        exposedPorts,
        variableSets,
      };
    }
    const docker = await this.remote.forServer(app.serverId);
    const [c, exposedPorts] = await Promise.all([
      docker.findContainerByName(containerNameFor(app)).catch(() => null),
      app.currentImage
        ? readExposedPorts(docker.engine, app.currentImage)
        : Promise.resolve(null),
    ]);
    return {
      ...app,
      container: c ? { id: c.Id, state: c.State, status: c.Status } : null,
      service: null,
      projectRole,
      secretSource,
      exposedPorts,
      variableSets,
    };
  }

  /** Swarm apps: the host daemon holds the image the service was deployed from. */
  private async exposedPortsOf(app: Application): Promise<number[] | null> {
    if (!app.currentImage) return null;
    try {
      const docker = await this.remote.forServer(app.serverId);
      return await readExposedPorts(docker.engine, app.currentImage);
    } catch {
      return null;
    }
  }
}
