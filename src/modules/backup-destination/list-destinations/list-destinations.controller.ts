import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { BackupDestinationDto } from '../backup-destination.service';
import { BackupDestinationService } from '../backup-destination.service';

/**
 * Readable by every member: the database page needs the list to pick a
 * destination, and the DTO carries no secret.
 */
@Controller('backup-destinations')
@UseGuards(JwtAuthGuard)
export class ListDestinationsController {
  constructor(private readonly destinations: BackupDestinationService) {}

  @Get()
  async list(): Promise<BackupDestinationDto[]> {
    const rows = await this.destinations.repo.find({
      order: { createdAt: 'ASC' },
    });
    return rows.map((d) => this.destinations.toDto(d));
  }
}
