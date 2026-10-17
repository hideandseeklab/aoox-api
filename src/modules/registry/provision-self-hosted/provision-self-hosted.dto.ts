import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import type { RegistryDto } from '../registry.service';

export class ProvisionSelfHostedDto {
  /** Store image data in this S3-compatible bucket instead of local disk. */
  @IsOptional()
  @IsUUID()
  destinationId?: string;

  /**
   * A container named `aoox-registry` exists that aoox has no record of.
   * Without this flag provisioning refuses (409); with it the old container
   * is removed first. Its volumes are kept (so pushed images survive) unless
   * `purgeVolumes` is also set. The htpasswd file is always rewritten, so the
   * generated password replaces the old one.
   */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;

  /** Only with `replace`: also delete the old data and auth volumes. */
  @IsOptional()
  @IsBoolean()
  purgeVolumes?: boolean;
}

export class ProvisionSelfHostedResponseDto {
  registry: RegistryDto;
  /** Shown once so the operator can `docker login`; stored encrypted afterwards. */
  username: string;
  password: string;
}
