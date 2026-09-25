import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseBackupService } from '../database-backup.service';
import { BackupParamsDto } from '../restore-backup/restore-backup.dto';

@Controller('backups')
@UseGuards(JwtAuthGuard)
export class DeleteBackupController {
  constructor(private readonly backups: DatabaseBackupService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: BackupParamsDto,
  ): Promise<void> {
    const backup = await this.backups.findOwnedOrFail(params.id, user.sub);
    await this.backups.deleteFile(backup).catch(() => undefined);
    await this.backups.repo.remove(backup);
  }
}
