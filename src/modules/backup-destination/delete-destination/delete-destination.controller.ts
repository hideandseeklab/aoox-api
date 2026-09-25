import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { BackupDestinationService } from '../backup-destination.service';

export class DeleteDestinationParamsDto {
  @IsUUID()
  id: string;
}

/**
 * Databases pointing here fall back to local-only backups (FK SET NULL);
 * objects already in the bucket are left alone.
 */
@Controller('backup-destinations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner', 'admin')
export class DeleteDestinationController {
  constructor(private readonly destinations: BackupDestinationService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: DeleteDestinationParamsDto): Promise<void> {
    const d = await this.destinations.findOrFail(params.id);
    await this.destinations.repo.remove(d);
  }
}
