import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import type { BackupDestinationDto } from '../backup-destination.service';
import { BackupDestinationService } from '../backup-destination.service';
import { CreateDestinationDto } from './create-destination.dto';

@Controller('backup-destinations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class CreateDestinationController {
  constructor(private readonly destinations: BackupDestinationService) {}

  @Post()
  async create(
    @Body() dto: CreateDestinationDto,
  ): Promise<BackupDestinationDto> {
    const entity = this.destinations.repo.create({
      name: dto.name.trim(),
      endpoint: dto.endpoint?.trim().replace(/\/+$/, '') || null,
      region: dto.region?.trim() ?? '',
      bucket: dto.bucket,
      prefix: (dto.prefix ?? '').replace(/^\/+|\/+$/g, ''),
      accessKeyId: dto.accessKeyId.trim(),
      secretAccessKeyEncrypted: this.destinations.encryptSecret(
        dto.secretAccessKey,
      ),
      forcePathStyle: dto.forcePathStyle ?? true,
    });
    return this.destinations.toDto(await this.destinations.repo.save(entity));
  }
}
