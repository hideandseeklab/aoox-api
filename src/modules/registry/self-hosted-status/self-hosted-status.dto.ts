import type { RegistryDto } from '../registry.service';
import type { SelfHostedState } from '../registry-state';
import type { SelfHostedStatus } from '../self-hosted-registry.service';

export class SelfHostedStatusResponseDto {
  dockerAvailable: boolean;
  /** Address to use with `docker login` / `docker push`. */
  publicUrl: string;
  /** Explicit relation between the Docker container and the DB row; see `deriveSelfHostedState`. */
  state: SelfHostedState;
  container: SelfHostedStatus;
  registry: RegistryDto | null;
}
