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
import { BackupFilesService } from '../../database-backup/backup-files.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { VolumeBackupParamsDto } from '../volume-backup.dto';
import { VolumeBackupService } from '../volume-backup.service';

@Controller('volume-backups')
@UseGuards(JwtAuthGuard)
export class DownloadVolumeBackupController {
  constructor(
    private readonly backups: VolumeBackupService,
    private readonly files: BackupFilesService,
    private readonly remote: RemoteDockerService,
  ) {}

  @Get(':id/download')
  async download(
    @CurrentUser() user: JwtPayload,
    @Param() params: VolumeBackupParamsDto,
    @Res() res: Response,
  ): Promise<void> {
    const backup = await this.backups.findOwnedOrFail(params.id, user.sub);
    try {
      await this.files.ensureLocal(
        backup,
        await this.remote.forServer(backup.application.serverId),
      );
    } catch (err) {
      throw new NotFoundException(
        err instanceof Error ? err.message : String(err),
      );
    }
    const name = backup.filename.split('/').pop() ?? 'backup.tar.gz';
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${backup.application.appName}-${backup.mount.name}-${name}"`,
    );
    if (backup.sizeBytes) res.setHeader('Content-Length', backup.sizeBytes);
    await this.backups.download(backup, res);
    res.end();
  }
}
