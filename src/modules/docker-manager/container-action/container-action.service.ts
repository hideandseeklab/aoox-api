import { Injectable } from '@nestjs/common';
import { DockerEngineError } from '../../docker/docker-engine.client';
import { DockerTargetService } from '../docker-target.service';

export type ContainerAction = 'start' | 'stop' | 'restart';

@Injectable()
export class ContainerActionService {
  constructor(private readonly target: DockerTargetService) {}

  /** start/stop/restart of a container aoox does not own (403 otherwise). */
  async execute(
    ref: string,
    action: ContainerAction,
    serverId?: string,
  ): Promise<void> {
    const handle = await this.target.handle(serverId);
    const container = await this.target.resolveUnmanaged(handle, ref, serverId);
    try {
      if (action === 'start') await handle.engine.startContainer(container.Id);
      else if (action === 'stop')
        await handle.engine.stopContainer(container.Id);
      else await handle.engine.restartContainer(container.Id);
    } catch (err) {
      // 304: already started — the state the caller wanted.
      if (err instanceof DockerEngineError && err.status === 304) return;
      throw this.target.toHttp(err);
    }
  }
}
