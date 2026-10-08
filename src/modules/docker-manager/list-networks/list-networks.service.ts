import { Injectable } from '@nestjs/common';
import type {
  ContainerSummary,
  NetworkSummary,
} from '../../docker/docker-engine.client';
import { DockerNetworkDto } from '../docker-manager.dto';
import { DockerTargetService } from '../docker-target.service';
import { isAooxNetwork, isBuiltinNetwork } from '../managed';

/** Pure: networks joined with the containers attached to them (by network name). */
export function toNetworkDtos(
  networks: NetworkSummary[],
  containers: ContainerSummary[],
): DockerNetworkDto[] {
  const users = new Map<string, string[]>();
  for (const c of containers) {
    for (const net of Object.keys(c.NetworkSettings?.Networks ?? {})) {
      const names = users.get(net) ?? [];
      names.push(c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12));
      users.set(net, names);
    }
  }
  return networks
    .map((n) => ({
      id: n.Id,
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
      internal: n.Internal === true,
      subnet: n.IPAM?.Config?.find((c) => c.Subnet)?.Subnet ?? null,
      usedByNames: users.get(n.Name) ?? [],
      builtin: isBuiltinNetwork(n.Name),
      managed: isAooxNetwork(n.Name, n.Labels),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

@Injectable()
export class ListNetworksService {
  constructor(private readonly target: DockerTargetService) {}

  async execute(serverId?: string): Promise<DockerNetworkDto[]> {
    const handle = await this.target.handle(serverId);
    try {
      const [networks, containers] = await Promise.all([
        handle.engine.listNetworks(),
        handle.engine.listContainers(),
      ]);
      return toNetworkDtos(networks, containers);
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
