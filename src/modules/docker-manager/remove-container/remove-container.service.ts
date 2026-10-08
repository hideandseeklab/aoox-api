import { Injectable } from '@nestjs/common';
import { DockerTargetService } from '../docker-target.service';

@Injectable()
export class RemoveContainerService {
  constructor(private readonly target: DockerTargetService) {}

  /**
   * Removes a container aoox does not own (403 otherwise). A running one
   * needs `force` (the daemon answers 409 otherwise); anonymous volumes of the
   * container are left alone, as with `docker rm` without `-v`.
   */
  async execute(ref: string, force: boolean, serverId?: string): Promise<void> {
    const handle = await this.target.handle(serverId);
    const container = await this.target.resolveUnmanaged(handle, ref, serverId);
    try {
      await handle.engine.removeContainer(container.Id, force);
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
