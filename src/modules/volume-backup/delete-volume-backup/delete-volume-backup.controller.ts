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
import { VolumeBackupParamsDto } from '../volume-backup.dto';
import { VolumeBackupService } from '../volume-backup.service';

@Controller('volume-backups')
@UseGuards(JwtAuthGuard)
export class DeleteVolumeBackupController {
  constructor(private readonly backups: VolumeBackupService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: VolumeBackupParamsDto,
  ): Promise<void> {
    const backup = await this.backups.findOwnedOrFail(params.id, user.sub);
    await this.backups.deleteFile(backup).catch(() => undefined);
    await this.backups.repo.remove(backup);
  }
}
