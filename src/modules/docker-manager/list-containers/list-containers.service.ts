import { Injectable } from '@nestjs/common';
import { hostname } from 'os';
import type { ContainerSummary } from '../../docker/docker-engine.client';
import { DockerContainerDto } from '../docker-manager.dto';
import { DockerTargetService } from '../docker-target.service';
import { classifyContainer } from '../managed';

export function toContainerDto(
  c: ContainerSummary,
  selfHostname?: string,
): DockerContainerDto {
  const names = c.Names.map((n) => n.replace(/^\//, ''));
  return {
    id: c.Id,
    name: names[0] ?? c.Id.slice(0, 12),
    image: c.Image,
    state: c.State,
    status: c.Status,
    createdAt: c.Created ? new Date(c.Created * 1000).toISOString() : null,
    ports: (c.Ports ?? []).map((p) => ({
      ip: p.IP ?? null,
      privatePort: p.PrivatePort,
      publicPort: p.PublicPort ?? null,
      type: p.Type,
    })),
    managed: classifyContainer(
      { id: c.Id, names, labels: c.Labels },
      selfHostname,
    ),
  };
}

@Injectable()
export class ListContainersService {
  constructor(private readonly target: DockerTargetService) {}

  /** One `GET /containers/json?all=1`; the summary never carries env vars. */
  async execute(serverId?: string): Promise<DockerContainerDto[]> {
    const handle = await this.target.handle(serverId);
    try {
      const list = await handle.engine.listContainers();
      const self = serverId ? undefined : hostname();
      return list
        .map((c) => toContainerDto(c, self))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
