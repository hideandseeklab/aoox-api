import { Injectable } from '@nestjs/common';
import { RegistryService } from '../registry.service';
import { RegistryCredentialsDto } from './get-registry-credentials.dto';

@Injectable()
export class GetRegistryCredentialsService {
  constructor(private readonly registries: RegistryService) {}

  async execute(id: string): Promise<RegistryCredentialsDto> {
    const { registry, password } = await this.registries.findWithPassword(id);
    return { url: registry.url, username: registry.username, password };
  }
}
