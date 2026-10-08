import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DockerTargetService } from '../docker-target.service';
import { PruneImagesResultDto } from '../docker-manager.dto';
import { ImageProtectionService } from '../image-protection.service';
import { isAooxImage, isSafeImageId } from '../managed';

@Injectable()
export class RemoveImageService {
  constructor(
    private readonly target: DockerTargetService,
    private readonly protection: ImageProtectionService,
  ) {}

  /**
   * Removes an image no container (running or stopped) was created from.
   * 409 when it is in use or belongs to aoox; the id is matched against the
   * daemon's own list, never forwarded as typed.
   */
  async remove(id: string, serverId?: string): Promise<void> {
    if (!isSafeImageId(id)) throw new NotFoundException('Image not found');
    const handle = await this.target.handle(serverId);
    try {
      const [images, containers] = await Promise.all([
        handle.engine.listImages(),
        handle.engine.listContainers(),
      ]);
      const wanted = id.replace(/^sha256:/, '');
      const matches = images.filter((i) =>
        i.Id.replace(/^sha256:/, '').startsWith(wanted),
      );
      if (matches.length !== 1) throw new NotFoundException('Image not found');
      const image = matches[0];
      const users = containers
        .filter((c) => c.ImageID === image.Id)
        .map((c) => c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12));
      if (users.length > 0) {
        throw new ConflictException(
          `Image is used by ${users.length} container(s): ${users.slice(0, 5).join(', ')}.`,
        );
      }
      if (isAooxImage(image.RepoTags)) {
        throw new ConflictException(
          'This image belongs to aoox (helper, panel or rollback image); clean it up from Settings > Docker disk.',
        );
      }
      const reason = (await this.protection.load(serverId ?? null)).reasonFor(
        image,
      );
      if (reason) throw new ConflictException(reason);
      // Nothing uses it, so `force` only lets a multi-tag image go in one call.
      await handle.engine.removeImage(image.Id, true);
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }

  /** Dangling (untagged, unreferenced) images only. */
  async pruneDangling(serverId?: string): Promise<PruneImagesResultDto> {
    const handle = await this.target.handle(serverId);
    try {
      const r = await handle.engine.pruneImages(false);
      return { deleted: r.deleted, reclaimedBytes: r.reclaimed };
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
