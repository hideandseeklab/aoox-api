import { Injectable } from '@nestjs/common';
import { RegistryService } from '../registry.service';
import { RepositoryDto } from './list-repositories.dto';

@Injectable()
export class ListRepositoriesService {
  constructor(private readonly registries: RegistryService) {}

  async execute(id: string): Promise<RepositoryDto[]> {
    const client = await this.registries.clientFor(id);
    const names = await client.listRepositories();
    return Promise.all(
      names.map(async (name) => ({
        name,
        tagCount: (await client.listTagNames(name)).length,
      })),
    );
  }
}
