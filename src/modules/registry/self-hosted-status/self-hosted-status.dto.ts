import type { RegistryDto } from '../registry.service';
import type { SelfHostedState } from '../registry-state';
import type { SelfHostedStatus } from '../self-hosted-registry.service';

export class SelfHostedStatusResponseDto {
  dockerAvailable: boolean;
  /**
   * Address the server itself uses (image references, the host's `docker push`):
   * `localhost:<port>` unless REGISTRY_PUBLIC_HOST says otherwise.
   */
  publicUrl: string;
  /** Interface the host port is published on (`REGISTRY_PUBLISH_ADDRESS`, default 127.0.0.1). */
  publishAddress: string;
  /** True when only this server can reach the registry (default binding, no domain). */
  localOnly: boolean;
  /**
   * Address other machines use for `docker login`/`push`: the registry domain,
   * or `<public host>:<port>` when the port is exposed; null when local only
   * (or exposed but the server's public IP is unknown).
   */
  externalAddress: string | null;
  /** Explicit relation between the Docker container and the DB row; see `deriveSelfHostedState`. */
  state: SelfHostedState;
  container: SelfHostedStatus;
  registry: RegistryDto | null;
}
