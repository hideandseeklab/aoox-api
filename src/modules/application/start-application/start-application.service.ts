import { Injectable, NotFoundException } from '@nestjs/common';
import { HostPortService } from '../../host-port/host-port.service';
import { ContainerInspect } from '../../docker/docker-engine.client';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { Application } from '../application.entity';
import { ApplicationService, containerNameFor } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { isOwnContainer } from '../own-container';
import { SwarmDeployService } from '../swarm-deploy.service';

@Injectable()
export class StartApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly runner: DeploymentRunnerService,
    private readonly hostPorts: HostPortService,
  ) {}

  async execute(ownerId: string, id: string): Promise<Application> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    if (app.deployMode === 'service') {
      // A service has no stop: scale to 0 (and back to `replicas`).
      await this.swarmDeploy.scale(app, app.replicas);
      app.status = 'running';
      return this.applications.repo.save(app);
    }
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker.findContainerByName(containerNameFor(app));
    if (!c)
      throw new NotFoundException(
        'Application has no container; deploy it first',
      );
    // The host port may have been changed while the app was stopped (the
    // stopped container keeps its old publishing): recreate it instead of
    // just starting it, after re-checking the port is still free — the
    // recreate removes the old container first.
    const inspected = await docker.engine.inspectContainer(c.Id);
    if (
      app.currentImage &&
      inspected &&
      publishedPort(app, inspected) !== (app.hostPort ?? null)
    ) {
      if (app.hostPort != null) {
        await this.hostPorts.assertFree([app.hostPort], docker, {
          excludeApplicationId: app.id,
          isOwnContainer: isOwnContainer(app),
        });
      }
      await this.runner.applyRuntimeConfig(app);
    } else {
      await docker.engine.startContainer(c.Id);
    }
    app.status = 'running';
    return this.applications.repo.save(app);
  }
}

/** Host port a (possibly stopped) container was created to publish for the app's container port. */
export function publishedPort(
  app: Pick<Application, 'containerPort'>,
  inspected: ContainerInspect,
): number | null {
  const bound =
    inspected.HostConfig?.PortBindings?.[`${app.containerPort}/tcp`]?.[0]
      ?.HostPort;
  return bound ? Number(bound) : null;
}
