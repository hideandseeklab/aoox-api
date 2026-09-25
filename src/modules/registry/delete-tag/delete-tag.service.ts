import { Injectable } from '@nestjs/common';
import { RegistryService } from '../registry.service';

/** Resolves the tag to its digest and deletes the manifest (blobs need a GC pass). */
@Injectable()
export class DeleteTagService {
  constructor(private readonly registries: RegistryService) {}

  async execute(id: string, repository: string, tag: string): Promise<void> {
    const client = await this.registries.clientFor(id);
    const { digest } = await client.getTag(repository, tag);
    await client.deleteManifest(repository, digest);
  }
}
