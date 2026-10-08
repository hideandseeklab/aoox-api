import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hostname } from 'os';
import { DockerEngineError } from '../docker/docker-engine.client';
import type { ContainerInspect } from '../docker/docker-engine.client';
import { DockerHandle } from '../docker/docker.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { classifyContainer, isSafeContainerRef } from './managed';
import type { ManagedInfo } from './managed';

/**
 * Daemon selection and the one place the "never touch aoox's own containers"
 * rule is enforced. Every write flow resolves its container through
 * `resolveUnmanaged`, which inspects it first — by the id the daemon reports,
 * not the string the caller sent — so a name and an id get the same verdict.
 */
@Injectable()
export class DockerTargetService {
  constructor(private readonly remote: RemoteDockerService) {}

  /** `serverId` null/undefined = the host daemon. */
  async handle(serverId?: string | null): Promise<DockerHandle> {
    try {
      return await this.remote.forServer(serverId ?? null);
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  /**
   * The container behind `ref`, only if it is not owned by aoox. 400-style
   * input errors and engine errors become HTTP errors; aoox-owned containers
   * are 403 with a pointer to the page that manages them.
   */
  async resolveUnmanaged(
    handle: DockerHandle,
    ref: string,
    serverId?: string | null,
  ): Promise<ContainerInspect> {
    if (!isSafeContainerRef(ref)) {
      throw new NotFoundException('Container not found');
    }
    let found: ContainerInspect | null;
    try {
      found = await handle.engine.inspectContainer(ref);
    } catch (err) {
      throw this.toHttp(err);
    }
    if (!found) throw new NotFoundException('Container not found');
    const managed = classifyContainer(
      {
        id: found.Id,
        names: [found.Name ?? ''],
        labels: found.Config.Labels,
      },
      serverId ? undefined : hostname(),
    );
    if (managed) throw new ForbiddenException(this.refusal(managed));
    return found;
  }

  refusal(managed: ManagedInfo): string {
    const where =
      managed.kind === 'panel'
        ? 'it is part of the aoox panel itself'
        : `it is managed by aoox (${managed.kind}); use its own page`;
    return `This container cannot be changed from the Docker page: ${where}.`;
  }

  /** Engine failures as HTTP errors with the daemon's own message. */
  toHttp(err: unknown): Error {
    if (
      err instanceof NotFoundException ||
      err instanceof ForbiddenException ||
      err instanceof ConflictException ||
      err instanceof BadGatewayException
    ) {
      return err;
    }
    if (err instanceof DockerEngineError) {
      if (err.status === 404) return new NotFoundException('Not found');
      if (err.status === 409) return new ConflictException(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    return new BadGatewayException(`Docker request failed: ${message}`);
  }
}
