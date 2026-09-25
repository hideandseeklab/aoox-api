import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/** Resource limits only; engine/image/credentials are fixed at creation. */
export class UpdateDatabaseDto {
  /** CPU limit in millicores (500 = half a core); null = unlimited. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(64_000)
  cpuMillicores?: number | null;

  /** Memory limit in MiB; null = unlimited. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(1_048_576)
  memoryMb?: number | null;
}
