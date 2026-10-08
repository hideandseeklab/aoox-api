import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProxyConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(70000)
  content?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Agree to recreate a proxy from an older aoox once (see `proxy-restart-required`). */
  @IsOptional()
  @IsBoolean()
  acceptProxyRestart?: boolean;
}
