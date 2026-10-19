import { Injectable, NotFoundException } from '@nestjs/common';
import {
  bindOfBinding,
  normalizeBind,
  type HostPortBind,
} from '../../docker/host-port-bind';
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
    // The host port or the container port may have been changed while the
    // app was stopped (the stopped container keeps its old publishing and its
    // old Traefik target port): recreate it instead of just starting it, after
    // re-checking the host port is still free — the recreate removes the old
    // container first.
    const inspected = await docker.engine.inspectContainer(c.Id);
    const routed = inspected ? routedPort(inspected) : null;
    if (
      app.currentImage &&
      inspected &&
      (publishedPort(app, inspected) !== (app.hostPort ?? null) ||
        (app.hostPort != null &&
          publishedBind(app, inspected) !== normalizeBind(app.hostPortBind)) ||
        (routed !== null && routed !== app.containerPort))
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

/**
 * Port Traefik was told to reach in this container (the
 * `traefik.http.services.<router>.loadbalancer.server.port` label written by
 * `ProxyService.buildLabels`); null when the container has no domain labels.
 */
export function routedPort(inspected: ContainerInspect): number | null {
  const labels = inspected.Config?.Labels ?? {};
  for (const [key, value] of Object.entries(labels)) {
    if (
      /^traefik\.http\.services\.[^.]+\.loadbalancer\.server\.port$/.test(key)
    ) {
      const port = Number(value);
      if (Number.isInteger(port) && port > 0) return port;
    }
  }
  return null;
}

/** Bind address a (possibly stopped) container was created with for the app's container port. */
export function publishedBind(
  app: Pick<Application, 'containerPort'>,
  inspected: ContainerInspect,
): HostPortBind {
  return bindOfBinding(
    inspected.HostConfig?.PortBindings?.[`${app.containerPort}/tcp`]?.[0],
  );
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
