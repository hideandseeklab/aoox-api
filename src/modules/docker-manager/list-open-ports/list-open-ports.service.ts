import { Injectable } from '@nestjs/common';
import { hostname } from 'os';
import { OpenPortDto } from '../docker-manager.dto';
import { DockerTargetService } from '../docker-target.service';
import { toOpenPorts } from './open-ports';

@Injectable()
export class ListOpenPortsService {
  constructor(private readonly target: DockerTargetService) {}

  /** One `GET /containers/json`; ports come from the same listing, nothing per row. */
  async execute(serverId?: string): Promise<OpenPortDto[]> {
    const handle = await this.target.handle(serverId);
    try {
      const list = await handle.engine.listContainers();
      return toOpenPorts(list, serverId ? undefined : hostname());
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
