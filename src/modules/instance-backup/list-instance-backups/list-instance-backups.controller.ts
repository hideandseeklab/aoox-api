import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { BackupFilesService } from '../../database-backup/backup-files.service';
import { InstanceBackup } from '../instance-backup.entity';
import { InstanceBackupService } from '../instance-backup.service';

@Controller('instance/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class ListInstanceBackupsController {
  constructor(
    private readonly backups: InstanceBackupService,
    private readonly files: BackupFilesService,
  ) {}

  /** Newest first, with `local` = file still on this server. */
  @Get()
  async list(): Promise<Array<InstanceBackup & { local: boolean }>> {
    const rows = await this.backups.repo.find({
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return this.files.annotate(rows);
  }
}
