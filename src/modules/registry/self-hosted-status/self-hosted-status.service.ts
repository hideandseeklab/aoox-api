import { Injectable } from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import { RegistryService } from '../registry.service';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';
import { SelfHostedStatusResponseDto } from './self-hosted-status.dto';

@Injectable()
export class SelfHostedStatusService {
  constructor(
    private readonly docker: DockerService,
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly registries: RegistryService,
  ) {}

  async execute(): Promise<SelfHostedStatusResponseDto> {
    const dockerAvailable = await this.docker.ping();
    const registry = await this.registries.findSelfHosted();
    return {
      dockerAvailable,
      publicUrl: this.selfHosted.publicUrl,
      container: dockerAvailable
        ? await this.selfHosted.status()
        : {
            installed: false,
            running: false,
            state: null,
            containerId: null,
            image: null,
          },
      registry: registry ? this.registries.toDto(registry) : null,
    };
  }
}
