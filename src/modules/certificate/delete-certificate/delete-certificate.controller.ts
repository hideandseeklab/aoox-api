import {
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CertificateParamsDto } from '../certificate-params.dto';
import { CertificateService } from '../certificate.service';

@Controller('certificates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteCertificateController {
  constructor(private readonly certs: CertificateService) {}

  /** In use = 409 (the FK is RESTRICT too): unassign it from the domains first. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: CertificateParamsDto): Promise<void> {
    const cert = await this.certs.findOrFail(params.id);
    const using = await this.certs.domains.find({
      where: { certificateId: cert.id },
      select: { id: true, host: true },
      order: { host: 'ASC' },
    });
    if (using.length > 0) {
      const shown = using.slice(0, 5).map((d) => d.host);
      const more = using.length > shown.length ? ', ...' : '';
      throw new ConflictException(
        `The certificate is used by ${using.length} domain(s): ${shown.join(', ')}${more}. Switch them back to automatic certificates first`,
      );
    }
    await this.certs.repo.remove(cert);
  }
}
