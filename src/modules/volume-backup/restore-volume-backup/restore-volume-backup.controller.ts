import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { BackupFilesService } from '../../database-backup/backup-files.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { VolumeBackupParamsDto } from '../volume-backup.dto';
import { VolumeBackupService } from '../volume-backup.service';

/** Overwrites the volume with the archive (container stopped meanwhile). */
@Controller('volume-backups')
@UseGuards(JwtAuthGuard)
export class RestoreVolumeBackupController {
  constructor(
    private readonly backups: VolumeBackupService,
    private readonly files: BackupFilesService,
    private readonly remote: RemoteDockerService,
  ) {}

  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore(
    @CurrentUser() user: JwtPayload,
    @Param() params: VolumeBackupParamsDto,
  ): Promise<void> {
    const backup = await this.backups.findOwnedOrFail(params.id, user.sub);
    try {
      await this.files.ensureLocal(
        backup,
        await this.remote.forServer(backup.application.serverId),
      );
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    await this.backups.restore(backup);
  }
}
