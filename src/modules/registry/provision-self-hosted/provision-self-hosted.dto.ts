import { IsOptional, IsUUID } from 'class-validator';
import type { RegistryDto } from '../registry.service';

export class ProvisionSelfHostedDto {
  /** Store image data in this S3-compatible bucket instead of local disk. */
  @IsOptional()
  @IsUUID()
  destinationId?: string;
}

export class ProvisionSelfHostedResponseDto {
  registry: RegistryDto;
  /** Shown once so the operator can `docker login`; stored encrypted afterwards. */
  username: string;
  password: string;
}
