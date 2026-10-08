import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { CONFIG_NAME } from '../proxy-config-schema';

export class CreateProxyConfigDto {
  /** Slug, `[a-z0-9-]{1,40}`: the file is written as `user-<name>.yml`. */
  @IsString()
  @Matches(CONFIG_NAME, {
    message: 'name must be 1-40 characters: lowercase letters, digits and "-"',
  })
  name: string;

  /** YAML document: `http` with middlewares, routers, services or serversTransports. */
  @IsString()
  @MaxLength(70000)
  content: string;

  /** Defaults to true; a disabled file is kept here but not written to the proxy. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Remote server whose proxy loads the file; omit for the aoox host. */
  @IsOptional()
  @IsUUID()
  serverId?: string;

  /** Agree to recreate a proxy from an older aoox once (see `proxy-restart-required`). */
  @IsOptional()
  @IsBoolean()
  acceptProxyRestart?: boolean;
}
