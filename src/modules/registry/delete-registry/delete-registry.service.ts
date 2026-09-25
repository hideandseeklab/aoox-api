import { BadRequestException, Injectable } from '@nestjs/common';
import { RegistryService } from '../registry.service';

@Injectable()
export class DeleteRegistryService {
  constructor(private readonly registries: RegistryService) {}

  async execute(id: string): Promise<void> {
    const registry = await this.registries.findOrFail(id);
    if (registry.type === 'self-hosted') {
      throw new BadRequestException(
        'Remove the self-hosted registry via DELETE /registries/self-hosted',
      );
    }
    await this.registries.repo.remove(registry);
  }
}
