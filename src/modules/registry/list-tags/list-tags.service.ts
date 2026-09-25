import { Injectable } from '@nestjs/common';
import { RegistryService } from '../registry.service';
import { TagDto } from './list-tags.dto';

@Injectable()
export class ListTagsService {
  constructor(private readonly registries: RegistryService) {}

  async execute(id: string, repository: string): Promise<TagDto[]> {
    const client = await this.registries.clientFor(id);
    const names = await client.listTagNames(repository);
    return Promise.all(names.map((tag) => client.getTag(repository, tag)));
  }
}
