import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One exposed service: `service:port` published on `host` via Traefik. */
export class ServiceDomainDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'service name is not valid' })
  service: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsString()
  @Length(1, 253)
  @Matches(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, {
    message: 'host must be a hostname like app.example.com',
  })
  host: string;

  @IsBoolean()
  https: boolean;
}

/** One published port: `service:port` bound to `hostPort` on the host. */
export class ServicePortDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'service name is not valid' })
  service: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsInt()
  @Min(1)
  @Max(65535)
  hostPort: number;
}

/** A CPU/RAM cap for one service; either field omitted = unlimited for it. */
export class ServiceResourcesDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'service name is not valid' })
  service: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64_000)
  cpuMillicores?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  memoryMb?: number | null;
}

/** Shared field rules; create requires projectId/name/gitUrl, update makes all optional. */
export class ComposeAppFieldsDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  /** http(s)/git URL without embedded credentials (use a git credential). */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  @Matches(/^(https?|git):\/\/[^\s#@]+$/, {
    message: 'gitUrl must be an http(s)/git URL without credentials',
  })
  gitUrl?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[\w./-]+$/)
  gitBranch?: string;

  @IsOptional()
  @IsUUID()
  gitCredentialId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(/^[\w./-]+$/, { message: 'composePath is not valid' })
  composePath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  env?: string;

  /** Only for `template` stacks: the compose file itself. */
  @IsOptional()
  @IsString()
  @Length(1, 200_000)
  composeContent?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceDomainDto)
  serviceDomains?: ServiceDomainDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServicePortDto)
  servicePorts?: ServicePortDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceResourcesDto)
  serviceResources?: ServiceResourcesDto[];
}

export class ComposeAppParamsDto {
  @IsUUID()
  id: string;
}
