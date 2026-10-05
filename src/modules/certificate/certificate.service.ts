import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Domain } from '../application/domain.entity';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import {
  CertificateInputError,
  CertificateMaterial,
  parseCertificateMaterial,
} from './certificate-material';
import { CustomCertificate } from './certificate.entity';
import { domainMatches } from './domain-matches';

/** What the API and the web may see: never the key (nor the PEM, which is public but large). */
export interface CertificateDto {
  id: string;
  name: string;
  commonName: string | null;
  domains: string[];
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  fingerprint: string;
  /** Number of application domains serving it. */
  usedBy: number;
  createdAt: Date;
}

@Injectable()
export class CertificateService {
  private readonly key: string;

  constructor(
    @InjectRepository(CustomCertificate)
    readonly repo: Repository<CustomCertificate>,
    @InjectRepository(Domain)
    readonly domains: Repository<Domain>,
    config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  toDto(c: CustomCertificate, usedBy: number): CertificateDto {
    return {
      id: c.id,
      name: c.name,
      commonName: c.commonName,
      domains: c.domains,
      issuer: c.issuer,
      notBefore: c.notBefore,
      notAfter: c.notAfter,
      fingerprint: c.fingerprint,
      usedBy,
      createdAt: c.createdAt,
    };
  }

  async findOrFail(id: string): Promise<CustomCertificate> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Certificate not found');
    return c;
  }

  async usedBy(id: string): Promise<number> {
    return this.domains.count({ where: { certificateId: id } });
  }

  /** Domain counts per certificate in one query (list view). */
  async usageCounts(): Promise<Map<string, number>> {
    const rows = await this.domains
      .createQueryBuilder('d')
      .select('d.certificate_id', 'id')
      .addSelect('count(*)', 'n')
      .where('d.certificate_id IS NOT NULL')
      .groupBy('d.certificate_id')
      .getRawMany<{ id: string; n: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  async dto(c: CustomCertificate): Promise<CertificateDto> {
    return this.toDto(c, await this.usedBy(c.id));
  }

  /** Validates an upload; the user-facing reason becomes a 400. */
  parse(certificate: string, privateKey: string): CertificateMaterial {
    try {
      return parseCertificateMaterial(certificate, privateKey);
    } catch (err) {
      if (err instanceof CertificateInputError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** 400 naming every host that `names` would no longer cover. */
  assertCovers(hosts: readonly string[], names: readonly string[]): void {
    const uncovered = hosts.filter((h) => !domainMatches(h, names));
    if (uncovered.length > 0) {
      throw new BadRequestException(
        `The certificate does not cover ${uncovered.join(', ')} (it is valid for ${names.join(', ')})`,
      );
    }
  }

  async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { name } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(
        `A certificate named "${name}" already exists`,
      );
    }
  }

  encryptKey(pem: string): string {
    return encryptSecret(pem, this.key);
  }

  decryptKey(encrypted: string): string {
    return decryptSecret(encrypted, this.key);
  }

  /** Loads certificates with their (decrypted) key, for the proxy volume only. */
  async withKeys(ids: readonly string[]): Promise<
    Array<{
      id: string;
      fingerprint: string;
      certificatePem: string;
      keyPem: string;
    }>
  > {
    if (ids.length === 0) return [];
    const rows = await this.repo
      .createQueryBuilder('c')
      .addSelect('c.privateKeyEncrypted')
      .where('c.id IN (:...ids)', { ids })
      .getMany();
    return rows.map((c) => ({
      id: c.id,
      fingerprint: c.fingerprint,
      certificatePem: c.certificatePem,
      keyPem: this.decryptKey(c.privateKeyEncrypted),
    }));
  }
}
