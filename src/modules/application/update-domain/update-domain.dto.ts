import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import { MIDDLEWARE_REF } from '../../proxy/middleware-ref';
import { CERT_MODES } from '../cert-mode';
import type { DomainCertMode } from '../domain.entity';

export { DeleteDomainParamsDto as UpdateDomainParamsDto } from '../delete-domain/delete-domain.dto';

/** At least one of the two fields; the service answers 400 when both are missing. */
export class UpdateDomainDto {
  /**
   * The uploaded certificate to serve, or null/"" to go back to automatic
   * (ACME) certificates. Omit it to leave the certificate alone.
   */
  @ValidateIf(
    (_: unknown, v: unknown) => v !== undefined && v !== null && v !== '',
  )
  @IsUUID()
  certificateId?: string | null;

  /**
   * Middlewares (`name@file`) from the operator dynamic config files of the
   * application's proxy, in the order they run; the whole list is replaced
   * (empty list = none). Omit it to leave them alone.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Matches(MIDDLEWARE_REF, {
    each: true,
    message: 'each middleware must look like name@file (lowercase, digits, -)',
  })
  middlewares?: string[];

  /** ACME mode (`http` | `dns` | `dns-wildcard`); the DNS modes need DNS-01 on the proxy. Omit to leave it. */
  @IsOptional()
  @IsIn(CERT_MODES)
  certMode?: DomainCertMode;

  /** DNS connection that manages the record; null/"" detaches it (aoox-created records are deleted). Omit to leave it. */
  @ValidateIf(
    (_: unknown, v: unknown) => v !== undefined && v !== null && v !== '',
  )
  @IsUUID()
  dnsConnectionId?: string | null;

  @IsOptional()
  @IsBoolean()
  dnsProxied?: boolean;

  /** Replace an existing record that has different content (otherwise only a warning). */
  @IsOptional()
  @IsBoolean()
  dnsOverwrite?: boolean;
}
