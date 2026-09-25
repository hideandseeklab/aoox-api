import { Injectable } from '@nestjs/common';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { MetricRetentionService } from '../../monitoring/metric-retention.service';
import { SwarmDeployService } from '../swarm-deploy.service';

/** Removes the container (if any) and the row; images in the registry are kept. */
@Injectable()
export class DeleteApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly retention: MetricRetentionService,
  ) {}

  async execute(ownerId: string, id: string): Promise<void> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker
      .findContainerByName(containerNameFor(app))
      .catch(() => null);
    if (c) await docker.engine.removeContainer(c.Id, true);
    if (app.deployMode === 'service') {
      await this.swarmDeploy.remove(app).catch(() => undefined);
    }
    await this.retention.forget('application', app.id);
    await this.applications.repo.remove(app);
  }
}
