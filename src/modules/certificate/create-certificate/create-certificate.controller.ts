import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { CertificateDto } from '../certificate.service';
import { CreateCertificateDto } from './create-certificate.dto';
import { CreateCertificateService } from './create-certificate.service';

@Controller('certificates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateCertificateController {
  constructor(private readonly service: CreateCertificateService) {}

  @Post()
  create(@Body() dto: CreateCertificateDto): Promise<CertificateDto> {
    return this.service.execute(dto);
  }
}
