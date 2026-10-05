import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { CertificateSyncService } from '../certificate-sync.service';
import { CertificateDto, CertificateService } from '../certificate.service';
import { UpdateCertificateDto } from './update-certificate.dto';

@Injectable()
export class UpdateCertificateService {
  private readonly logger = new Logger(UpdateCertificateService.name);

  constructor(
    private readonly certs: CertificateService,
    private readonly sync: CertificateSyncService,
  ) {}

  /** Replaces the content (renewal). Domains already using it must stay covered. */
  async execute(
    id: string,
    dto: UpdateCertificateDto,
  ): Promise<CertificateDto> {
    const cert = await this.certs.findOrFail(id);
    const material = this.certs.parse(dto.certificate, dto.privateKey);
    const using = await this.certs.domains.find({
      where: { certificateId: id },
      select: { id: true, host: true },
    });
    this.certs.assertCovers(
      using.map((d) => d.host),
      material.domains,
    );

    cert.certificatePem = material.certificatePem;
    cert.privateKeyEncrypted = this.certs.encryptKey(material.privateKeyPem);
    cert.commonName = material.commonName;
    cert.domains = material.domains;
    cert.issuer = material.issuer;
    cert.notBefore = material.notBefore;
    cert.notAfter = material.notAfter;
    cert.fingerprint = material.fingerprint;
    const saved = await this.certs.repo.save(cert);

    // Traefik reloads the volume by itself: no proxy or container restart.
    try {
      await this.sync.syncForCertificate(id);
    } catch (err) {
      this.logger.warn(
        `Certificate ${id} saved but not synced: ${String(err)}`,
      );
      throw new BadGatewayException(
        'The certificate was saved, but could not be written to the proxy; save it again to retry',
      );
    }
    return this.certs.toDto(saved, using.length);
  }
}
