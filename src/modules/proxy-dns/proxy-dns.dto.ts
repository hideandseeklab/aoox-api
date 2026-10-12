import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ProxyDnsQueryDto {
  /** Remote server whose proxy this is; omit for the aoox host. */
  @IsOptional()
  @IsUUID()
  serverId?: string;
}

export class ClearProxyDnsQueryDto extends ProxyDnsQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  acceptProxyRestart?: boolean;
}

export class SetProxyDnsDto extends ProxyDnsQueryDto {
  @IsUUID()
  connectionId: string;

  /** Agree to recreate the running proxy (a few seconds without service). */
  @IsOptional()
  @IsBoolean()
  acceptProxyRestart?: boolean;
}
