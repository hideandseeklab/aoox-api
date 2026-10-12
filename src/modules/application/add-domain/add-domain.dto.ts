import { CERT_MODES } from '../cert-mode';
import type { DomainCertMode } from '../domain.entity';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class AddDomainDto {
  @IsString()
  @MaxLength(253)
  @Matches(/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))*$/i, {
    message: 'host must be a valid hostname like app.example.com',
  })
  host: string;

  @IsOptional()
  @IsBoolean()
  https?: boolean;

  /**
   * Serve this uploaded certificate instead of an automatic one. Only with
   * `https: true`; it must cover the host. `""`/null mean "automatic" (the
   * web form sends an empty string when nothing is chosen).
   */
  @ValidateIf(
    (_: unknown, v: unknown) => v !== undefined && v !== null && v !== '',
  )
  @IsUUID()
  certificateId?: string | null;

  /** ACME mode: `http` (default), `dns` (DNS-01 per host) or `dns-wildcard`. Needs DNS-01 on the proxy. */
  @IsOptional()
  @IsIn(CERT_MODES)
  certMode?: DomainCertMode;

  /** DNS connection that should create this host's record; `""`/null = manage DNS yourself. */
  @ValidateIf(
    (_: unknown, v: unknown) => v !== undefined && v !== null && v !== '',
  )
  @IsUUID()
  dnsConnectionId?: string | null;

  /** Cloudflare proxied (orange cloud) flag for the record. */
  @IsOptional()
  @IsBoolean()
  dnsProxied?: boolean;

  /** Replace an existing record with different content instead of only warning. */
  @IsOptional()
  @IsBoolean()
  dnsOverwrite?: boolean;
}
