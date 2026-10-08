import { Injectable } from '@nestjs/common';
import type {
  ContainerSummary,
  ImageSummary,
} from '../../docker/docker-engine.client';
import { DockerImageDto } from '../docker-manager.dto';
import { DockerTargetService } from '../docker-target.service';
import { ImageProtectionService } from '../image-protection.service';
import { isAooxImage } from '../managed';

/** Pure: images joined with the containers created from them (one list each, no N+1). */
export function toImageDtos(
  images: ImageSummary[],
  containers: ContainerSummary[],
  reasonFor: (image: ImageSummary) => string | null = () => null,
): DockerImageDto[] {
  const byImage = new Map<string, string[]>();
  for (const c of containers) {
    if (!c.ImageID) continue;
    const names = byImage.get(c.ImageID) ?? [];
    names.push(c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12));
    byImage.set(c.ImageID, names);
  }
  return images
    .map((img) => {
      const tags = (img.RepoTags ?? []).filter((t) => t !== '<none>:<none>');
      const usedByNames = byImage.get(img.Id) ?? [];
      return {
        id: img.Id,
        tags,
        size: img.Size,
        createdAt: new Date(img.Created * 1000).toISOString(),
        usedBy: usedByNames.length,
        usedByNames,
        dangling: tags.length === 0,
        managed: isAooxImage(tags),
        protectedReason: reasonFor(img),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

@Injectable()
export class ListImagesService {
  constructor(
    private readonly target: DockerTargetService,
    private readonly protection: ImageProtectionService,
  ) {}

  async execute(serverId?: string): Promise<DockerImageDto[]> {
    const handle = await this.target.handle(serverId);
    try {
      const [images, containers, protection] = await Promise.all([
        handle.engine.listImages(),
        handle.engine.listContainers(),
        this.protection.load(serverId ?? null),
      ]);
      return toImageDtos(images, containers, protection.reasonFor);
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
