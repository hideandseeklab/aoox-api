import { Domain, DomainCertMode } from './domain.entity';

/** What the API returns for a domain: the certificate by id and name only (never its PEM or key). */
export interface DomainDto {
  id: string;
  applicationId: string;
  host: string;
  https: boolean;
  certificateId: string | null;
  certificateName: string | null;
  /** Operator middlewares (`name@file`) in front of this host, in order. */
  middlewares: string[];
  /** ACME mode of an https host without an uploaded certificate. */
  certMode: DomainCertMode;
  /** DNS connection managing this host's record, with its name (null = none). */
  dnsConnectionId: string | null;
  dnsConnectionName: string | null;
  dnsProxied: boolean;
  /** Last record sync: ok | warning | error (null = never ran / not managed). */
  dnsStatus: 'ok' | 'warning' | 'error' | null;
  dnsMessage: string | null;
  createdAt: Date;
}

export function toDomainDto(
  d: Pick<
    Domain,
    | 'id'
    | 'applicationId'
    | 'host'
    | 'https'
    | 'certificateId'
    | 'middlewares'
    | 'createdAt'
    | 'certMode'
    | 'dnsConnectionId'
    | 'dnsProxied'
    | 'dnsStatus'
    | 'dnsMessage'
  >,
  certificateName: string | null,
  dnsConnectionName: string | null = null,
): DomainDto {
  return {
    id: d.id,
    applicationId: d.applicationId,
    host: d.host,
    https: d.https,
    certificateId: d.certificateId ?? null,
    certificateName: d.certificateId ? certificateName : null,
    middlewares: d.middlewares ?? [],
    certMode: d.certMode ?? 'http',
    dnsConnectionId: d.dnsConnectionId ?? null,
    dnsConnectionName: d.dnsConnectionId ? dnsConnectionName : null,
    dnsProxied: d.dnsProxied ?? false,
    dnsStatus: d.dnsConnectionId ? (d.dnsStatus ?? null) : null,
    dnsMessage: d.dnsConnectionId ? (d.dnsMessage ?? null) : null,
    createdAt: d.createdAt,
  };
}
