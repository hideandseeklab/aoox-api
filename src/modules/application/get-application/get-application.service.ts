import { Injectable } from '@nestjs/common';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { Application } from '../application.entity';
import { ApplicationService, containerNameFor } from '../application.service';
import { ProjectAccessService } from '../../project/project-access.service';
import type { ProjectRole } from '../../project/project-member.entity';
import { ServiceStatus, SwarmDeployService } from '../swarm-deploy.service';

export interface ApplicationDetail extends Application {
  /** Live container state from Docker, or null when no container exists. */
  container: { id: string; state: string; status: string } | null;
  /** Swarm service (deployMode 'service'), or null. */
  service: ServiceStatus | null;
  /** The actor's role in the owning project (UI hides what a viewer cannot do). */
  projectRole: ProjectRole;
}

@Injectable()
export class GetApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(ownerId: string, id: string): Promise<ApplicationDetail> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    const projectRole = (await this.access.roleFor(ownerId, app.project))!;
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
      return { ...app, container, service, projectRole };
    }
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker
      .findContainerByName(containerNameFor(app))
      .catch(() => null);
    return {
      ...app,
      container: c ? { id: c.Id, state: c.State, status: c.Status } : null,
      service: null,
      projectRole,
    };
  }
}
