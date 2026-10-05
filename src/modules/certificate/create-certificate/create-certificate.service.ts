import { ConflictException, Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CertificateDto, CertificateService } from '../certificate.service';
import { CreateCertificateDto } from './create-certificate.dto';

@Injectable()
export class CreateCertificateService {
  constructor(private readonly certs: CertificateService) {}

  async execute(dto: CreateCertificateDto): Promise<CertificateDto> {
    const material = this.certs.parse(dto.certificate, dto.privateKey);
    await this.certs.assertNameFree(dto.name);
    try {
      const saved = await this.certs.repo.save(
        this.certs.repo.create({
          name: dto.name,
          certificatePem: material.certificatePem,
          privateKeyEncrypted: this.certs.encryptKey(material.privateKeyPem),
          commonName: material.commonName,
          domains: material.domains,
          issuer: material.issuer,
          notBefore: material.notBefore,
          notAfter: material.notAfter,
          fingerprint: material.fingerprint,
        }),
      );
      return this.certs.toDto(saved, 0);
    } catch (err) {
      // Two concurrent uploads with the same name: the unique index decides.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new ConflictException(
          `A certificate named "${dto.name}" already exists`,
        );
      }
      throw err;
    }
  }
}
