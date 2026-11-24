import { BadGatewayException, Injectable } from '@nestjs/common';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { envWithoutImageDefaults, redactorForEnv } from '../log-redaction';
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
      // Fail closed: without the service spec env the output cannot be masked.
      let svc: Awaited<ReturnType<SwarmDeployService['inspect']>>;
      try {
        svc = await this.swarmDeploy.inspect(app);
      } catch {
        throw new BadGatewayException(
          'Could not read the service, so its logs cannot be masked.',
        );
      }
      if (!svc) return { logs: '' };
      const logs = await this.swarmDeploy.docker.engine.serviceLogs(
        svc.ID,
        tail,
      );
      return {
        logs: redactorForEnv(
          svc.Spec.TaskTemplate.ContainerSpec.Env ?? [],
        ).apply(logs),
      };
    }
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker.findContainerByName(containerNameFor(app));
    if (!c) return { logs: '' };
    // Fail closed: without the env the output cannot be masked.
    let info: Awaited<ReturnType<typeof docker.engine.inspectContainer>>;
    try {
      info = await docker.engine.inspectContainer(c.Id);
    } catch {
      throw new BadGatewayException(
        'Could not read the container, so its logs cannot be masked.',
      );
    }
    // Values baked into the image are not secrets (`nginx/1.31.9`).
    const env = await envWithoutImageDefaults(docker.engine, info);
    const logs = await docker.engine.containerLogs(c.Id, tail);
    return { logs: redactorForEnv(env).apply(logs) };
  }
}
