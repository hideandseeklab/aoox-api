import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CertificateParamsDto } from '../certificate-params.dto';
import { CertificateDto } from '../certificate.service';
import { UpdateCertificateDto } from './update-certificate.dto';
import { UpdateCertificateService } from './update-certificate.service';

@Controller('certificates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class UpdateCertificateController {
  constructor(private readonly service: UpdateCertificateService) {}

  @Put(':id')
  update(
    @Param() params: CertificateParamsDto,
    @Body() dto: UpdateCertificateDto,
  ): Promise<CertificateDto> {
    return this.service.execute(params.id, dto);
  }
}
