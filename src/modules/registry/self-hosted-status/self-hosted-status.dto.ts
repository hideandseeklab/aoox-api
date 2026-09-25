import type { RegistryDto } from '../registry.service';
import type { SelfHostedStatus } from '../self-hosted-registry.service';

export class SelfHostedStatusResponseDto {
  dockerAvailable: boolean;
  /** Address to use with `docker login` / `docker push`. */
  publicUrl: string;
  container: SelfHostedStatus;
  registry: RegistryDto | null;
}
