import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Application } from '../../application/application.entity';
import { ApplicationService } from '../../application/application.service';
import { ApplicationParamsDto } from '../../application/get-application/get-application.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { BackupDestinationService } from '../../backup-destination/backup-destination.service';
import { UpdateBackupScheduleDto } from '../../database-backup/update-backup-schedule/update-backup-schedule.dto';
import { VolumeBackupSchedulerService } from '../volume-backup-scheduler.service';

/** Same body as the database schedule: `{ backupCron, backupKeep, backupDestinationId }`. */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class UpdateVolumeBackupScheduleController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly scheduler: VolumeBackupSchedulerService,
    private readonly destinations: BackupDestinationService,
  ) {}

  @Patch(':id/backup-schedule')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: UpdateBackupScheduleDto,
  ): Promise<Application> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    if (dto.backupCron !== undefined) {
      if (
        dto.backupCron &&
        !VolumeBackupSchedulerService.isValidCron(dto.backupCron)
      ) {
        throw new BadRequestException('Invalid cron expression');
      }
      app.backupCron = dto.backupCron;
    }
    if (dto.backupKeep !== undefined) app.backupKeep = dto.backupKeep;
    if (dto.backupDestinationId !== undefined) {
      if (dto.backupDestinationId)
        await this.destinations.findOrFail(dto.backupDestinationId);
      app.backupDestinationId = dto.backupDestinationId;
    }
    const saved = await this.applications.repo.save(app);
    this.scheduler.reschedule(saved);
    return saved;
  }
}
