import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { BackupFilesService } from '../backup-files.service';
import { DatabaseBackupService } from '../database-backup.service';
import { BackupParamsDto } from '../restore-backup/restore-backup.dto';

@Controller('backups')
@UseGuards(JwtAuthGuard)
export class DownloadBackupController {
  constructor(
    private readonly backups: DatabaseBackupService,
    private readonly files: BackupFilesService,
  ) {}

  @Get(':id/download')
  async download(
    @CurrentUser() user: JwtPayload,
    @Param() params: BackupParamsDto,
    @Res() res: Response,
  ): Promise<void> {
    const backup = await this.backups.findOwnedOrFail(params.id, user.sub);
    try {
      await this.files.ensureLocal(backup);
    } catch (err) {
      throw new NotFoundException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const name = backup.filename.split('/').pop() ?? 'backup';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${backup.database.slug}-${name}"`,
    );
    if (backup.sizeBytes) res.setHeader('Content-Length', backup.sizeBytes);
    await this.backups.download(backup, res);
    res.end();
  }
}
