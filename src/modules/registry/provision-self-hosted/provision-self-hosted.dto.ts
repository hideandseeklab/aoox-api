import type { RegistryDto } from '../registry.service';

export class ProvisionSelfHostedResponseDto {
  registry: RegistryDto;
  /** Shown once so the operator can `docker login`; stored encrypted afterwards. */
  username: string;
  password: string;
}
