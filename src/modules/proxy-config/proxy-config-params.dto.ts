import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ProxyConfigParamsDto {
  @IsUUID()
  id: string;
}

/** The proxy a request is about: the remote server id, or nothing for the aoox host. */
export class ProxyServerQueryDto {
  @IsOptional()
  @IsUUID()
  serverId?: string;

  /** `true` agrees to recreate a proxy from an older aoox once (sync only). */
  @IsOptional()
  @IsIn(['true'])
  acceptProxyRestart?: string;
}
