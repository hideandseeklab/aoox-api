import { Injectable } from '@nestjs/common';
import { RegistryDto, RegistryService } from '../registry.service';

@Injectable()
export class ListRegistriesService {
  constructor(private readonly registries: RegistryService) {}

  async execute(): Promise<RegistryDto[]> {
    const rows = await this.registries.repo.find({
      order: { type: 'DESC', createdAt: 'ASC' },
    });
    return rows.map((r) => this.registries.toDto(r));
  }
}
