import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CertificateParamsDto } from '../certificate-params.dto';
import { CertificateDto, CertificateService } from '../certificate.service';

/**
 * Readable by every member: the Domain tab needs the list for its dropdown.
 * The DTO never carries the key (nor the PEM).
 */
@Controller('certificates')
@UseGuards(JwtAuthGuard)
export class ListCertificatesController {
  constructor(private readonly certs: CertificateService) {}

  @Get()
  async list(): Promise<CertificateDto[]> {
    const [rows, counts] = await Promise.all([
      this.certs.repo.find({ order: { name: 'ASC' } }),
      this.certs.usageCounts(),
    ]);
    return rows.map((c) => this.certs.toDto(c, counts.get(c.id) ?? 0));
  }

  @Get(':id')
  async get(@Param() params: CertificateParamsDto): Promise<CertificateDto> {
    return this.certs.dto(await this.certs.findOrFail(params.id));
  }
}
