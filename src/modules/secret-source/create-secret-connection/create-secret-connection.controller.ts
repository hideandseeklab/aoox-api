import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { SecretConnectionDto } from '../secret-source.service';
import { CreateSecretConnectionDto } from './create-secret-connection.dto';
import { CreateSecretConnectionService } from './create-secret-connection.service';

@Controller('secret-connections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateSecretConnectionController {
  constructor(private readonly service: CreateSecretConnectionService) {}

  @Post()
  create(@Body() dto: CreateSecretConnectionDto): Promise<SecretConnectionDto> {
    return this.service.execute(dto);
  }
}
