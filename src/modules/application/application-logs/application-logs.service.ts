import { Injectable } from '@nestjs/common';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { SwarmDeployService } from '../swarm-deploy.service';
import { ApplicationLogsResponseDto } from './application-logs.dto';

/** Container stdout/stderr of the running application. */
@Injectable()
export class ApplicationLogsService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
  ) {}

  async execute(
    ownerId: string,
    id: string,
    tail: number,
  ): Promise<ApplicationLogsResponseDto> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    if (app.deployMode === 'service') {
      const svc = await this.swarmDeploy.inspect(app);
      if (!svc) return { logs: '' };
      return {
        logs: await this.swarmDeploy.docker.engine.serviceLogs(svc.ID, tail),
      };
    }
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker.findContainerByName(containerNameFor(app));
    if (!c) return { logs: '' };
    return { logs: await docker.engine.containerLogs(c.Id, tail) };
  }
}
