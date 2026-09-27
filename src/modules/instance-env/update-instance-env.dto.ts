import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Every field is optional and independent: omitted = leave that variable
 * alone, empty string = clear it (falls back to the compose file's own
 * `${VAR:-default}`). Only variables the panel's own `docker-compose.dist.yml`
 * actually wires into the `api` service's environment belong here — adding a
 * field here without also adding it to that compose file would silently do
 * nothing.
 */
export class UpdateInstanceEnvDto {
  @IsOptional()
  @IsString()
  @MaxLength(253)
  terminalSshHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  terminalSshPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  terminalSshUser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  terminalSshPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  publicIp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  registryPublicHost?: string;
}
