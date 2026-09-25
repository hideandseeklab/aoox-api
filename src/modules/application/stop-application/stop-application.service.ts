import { Injectable, NotFoundException } from '@nestjs/common';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { Application } from '../application.entity';
import { ApplicationService, containerNameFor } from '../application.service';
import { SwarmDeployService } from '../swarm-deploy.service';

@Injectable()
export class StopApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
  ) {}

  async execute(ownerId: string, id: string): Promise<Application> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    if (app.deployMode === 'service') {
      // A service has no stop: scale to 0 (and back to `replicas`).
      await this.swarmDeploy.scale(app, 0);
      app.status = 'stopped';
      return this.applications.repo.save(app);
    }
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker.findContainerByName(containerNameFor(app));
    if (!c)
      throw new NotFoundException(
        'Application has no container; deploy it first',
      );
    await docker.engine.stopContainer(c.Id);
    app.status = 'stopped';
    return this.applications.repo.save(app);
  }
}
