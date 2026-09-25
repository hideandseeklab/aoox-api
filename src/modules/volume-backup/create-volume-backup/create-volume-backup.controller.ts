import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApplicationService } from '../../application/application.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { MountBackupParamsDto } from '../volume-backup.dto';
import { VolumeBackup } from '../volume-backup.entity';
import { VolumeBackupService } from '../volume-backup.service';

/** Backs up one volume mount now (synchronous; small volumes finish in seconds). */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CreateVolumeBackupController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly backups: VolumeBackupService,
  ) {}

  @Post(':id/mounts/:mountId/backups')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Param() params: MountBackupParamsDto,
  ): Promise<VolumeBackup> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const mount = await this.applications.mounts.findOne({
      where: { id: params.mountId, applicationId: app.id },
    });
    if (!mount) throw new NotFoundException('Mount not found');
    return this.backups.backup(app, mount, 'manual');
  }
}
