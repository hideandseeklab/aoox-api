import { Injectable } from '@nestjs/common';
import { RegistryService } from '../registry.service';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';

@Injectable()
export class RemoveSelfHostedService {
  constructor(
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly registries: RegistryService,
  ) {}

  async execute(purge: boolean): Promise<void> {
    await this.selfHosted.remove(purge);
    const registry = await this.registries.findSelfHosted();
    if (registry) await this.registries.repo.remove(registry);
  }
}
