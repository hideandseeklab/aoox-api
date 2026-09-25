import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../../managed-database/get-database/get-database.dto';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { DatabaseBackup } from '../database-backup.entity';
import { BackupFilesService } from '../backup-files.service';
import { DatabaseBackupService } from '../database-backup.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class ListBackupsController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly backups: DatabaseBackupService,
    private readonly files: BackupFilesService,
  ) {}

  @Get(':id/backups')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<Array<DatabaseBackup & { local: boolean }>> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const rows = await this.backups.repo.find({
      where: { databaseId: db.id },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    // `local: false` + a remote key = still restorable (pulled from S3 on demand).
    return this.files.annotate(rows);
  }
}
