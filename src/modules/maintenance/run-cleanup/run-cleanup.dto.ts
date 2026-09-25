import { IsBoolean, IsOptional } from 'class-validator';

export class RunCleanupDto {
  /** Also garbage-collect the self-hosted registry (default true). */
  @IsOptional()
  @IsBoolean()
  registryGc?: boolean;

  /** Also delete orphaned volumes (default false — see MaintenanceService.cleanup). */
  @IsOptional()
  @IsBoolean()
  pruneVolumes?: boolean;
}
