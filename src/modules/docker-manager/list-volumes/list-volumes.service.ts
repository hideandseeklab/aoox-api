import { Injectable } from '@nestjs/common';
import type {
  ContainerSummary,
  SystemDataUsage,
} from '../../docker/docker-engine.client';
import { MaintenanceService } from '../../maintenance/maintenance.service';
import { DockerVolumeDto } from '../docker-manager.dto';
import { DockerTargetService } from '../docker-target.service';
import { isAooxVolume } from '../managed';

/** Pure: df volumes joined with the containers that mount them. */
export function toVolumeDtos(
  df: SystemDataUsage,
  containers: ContainerSummary[],
  orphans: Set<string>,
): DockerVolumeDto[] {
  const users = new Map<string, string[]>();
  for (const c of containers) {
    for (const m of c.Mounts ?? []) {
      if (m.Type !== 'volume' || !m.Name) continue;
      const names = users.get(m.Name) ?? [];
      names.push(c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12));
      users.set(m.Name, names);
    }
  }
  return df.Volumes.map((v) => {
    const size = v.UsageData?.Size;
    return {
      name: v.Name,
      driver: v.Driver ?? 'local',
      size: typeof size === 'number' && size >= 0 ? size : null,
      createdAt: v.CreatedAt ?? null,
      usedByNames: users.get(v.Name) ?? [],
      managed: isAooxVolume(v.Name, v.Labels),
      orphan: orphans.has(v.Name),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

@Injectable()
export class ListVolumesService {
  constructor(
    private readonly target: DockerTargetService,
    private readonly maintenance: MaintenanceService,
  ) {}

  async execute(serverId?: string): Promise<DockerVolumeDto[]> {
    const handle = await this.target.handle(serverId);
    try {
      const [df, containers] = await Promise.all([
        handle.engine.systemDataUsage(),
        handle.engine.listContainers(),
      ]);
      // Orphans come from this panel's DB, which only knows the host's volumes.
      const orphans = serverId
        ? new Set<string>()
        : new Set(await this.maintenance.orphanVolumeNames(df));
      return toVolumeDtos(df, containers, orphans);
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
