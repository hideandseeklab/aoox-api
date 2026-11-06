import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { parseReadTimeoutSeconds } from '../proxy/read-timeout';

/** Empty clears the setting; anything else must parse to 1-86400 seconds. */
@ValidatorConstraint({ name: 'isProxyReadTimeout', async: false })
export class ReadTimeoutConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      (value.trim() === '' || parseReadTimeoutSeconds(value) !== null)
    );
  }

  defaultMessage(): string {
    return 'proxyReadTimeout must be whole seconds (300) or a duration (300s, 5m) between 1 and 86400 seconds, or empty';
  }
}

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

  /** Whole seconds (`300`) or a duration (`300s`, `5m`, `1h`), 1-86400 s; empty = Traefik's default. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Validate(ReadTimeoutConstraint)
  proxyReadTimeout?: string;
}
