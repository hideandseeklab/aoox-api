import { Domain } from './domain.entity';

/** What the API returns for a domain: the certificate by id and name only (never its PEM or key). */
export interface DomainDto {
  id: string;
  applicationId: string;
  host: string;
  https: boolean;
  certificateId: string | null;
  certificateName: string | null;
  createdAt: Date;
}

export function toDomainDto(
  d: Pick<
    Domain,
    'id' | 'applicationId' | 'host' | 'https' | 'certificateId' | 'createdAt'
  >,
  certificateName: string | null,
): DomainDto {
  return {
    id: d.id,
    applicationId: d.applicationId,
    host: d.host,
    https: d.https,
    certificateId: d.certificateId ?? null,
    certificateName: d.certificateId ? certificateName : null,
    createdAt: d.createdAt,
  };
}
