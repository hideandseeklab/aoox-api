import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApplicationService } from '../../application/application.service';
import { ApplicationParamsDto } from '../../application/get-application/get-application.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { BackupFilesService } from '../../database-backup/backup-files.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { VolumeBackup } from '../volume-backup.entity';
import { VolumeBackupService } from '../volume-backup.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListVolumeBackupsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly backups: VolumeBackupService,
    private readonly files: BackupFilesService,
    private readonly remote: RemoteDockerService,
  ) {}

  @Get(':id/volume-backups')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Array<VolumeBackup & { local: boolean }>> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const rows = await this.backups.repo.find({
      where: { applicationId: app.id },
      order: { createdAt: 'DESC' },
    });
    return this.files.annotate(rows, await this.remote.forServer(app.serverId));
  }
}
