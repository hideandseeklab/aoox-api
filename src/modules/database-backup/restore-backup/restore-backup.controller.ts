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
import { BackupFilesService } from '../backup-files.service';
import { DatabaseBackupService } from '../database-backup.service';
import { BackupParamsDto } from './restore-backup.dto';

/** Overwrites the database with the backup contents. */
@Controller('backups')
@UseGuards(JwtAuthGuard)
export class RestoreBackupController {
  constructor(
    private readonly backups: DatabaseBackupService,
    private readonly files: BackupFilesService,
  ) {}

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentUser() user: JwtPayload,
    @Param() params: BackupParamsDto,
  ): Promise<{ restored: true }> {
    const backup = await this.backups.findOwnedOrFail(params.id, user.sub);
    try {
      // Pulled back from S3 first when the local copy was pruned.
      await this.files.ensureLocal(backup);
      await this.backups.restore(backup, backup.database);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }
    return { restored: true };
  }
}
