import { Injectable } from '@nestjs/common';
import { DockerService } from '../../docker/docker.service';
import { RegistryService } from '../registry.service';
import { deriveSelfHostedState } from '../registry-state';
import {
  SelfHostedRegistryService,
  type SelfHostedStatus,
} from '../self-hosted-registry.service';
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
    const container: SelfHostedStatus = dockerAvailable
      ? await this.selfHosted.status()
      : {
          installed: false,
          running: false,
          state: null,
          containerId: null,
          image: null,
        };
    return {
      dockerAvailable,
      publicUrl: this.selfHosted.publicUrl,
      state: deriveSelfHostedState(
        dockerAvailable,
        container,
        registry !== null,
      ),
      container,
      registry: registry ? this.registries.toDto(registry) : null,
    };
  }
}
