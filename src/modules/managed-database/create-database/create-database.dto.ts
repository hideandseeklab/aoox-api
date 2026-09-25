import {
  ValidateIf,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateDatabaseDto {
  @IsUUID()
  projectId: string;

  @IsString()
  @Length(1, 100)
  name: string;

  @IsIn(['postgres', 'mysql', 'mariadb', 'redis'])
  engine: 'postgres' | 'mysql' | 'mariadb' | 'redis';

  /** Image tag; defaults per engine (e.g. `16-alpine`). */
  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  imageTag?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  hostPort?: number | null;

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
