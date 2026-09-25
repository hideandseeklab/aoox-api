import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { BackupSchedulerService } from '../../database-backup/backup-scheduler.service';
import { InstanceBackupSchedulerService } from '../instance-backup-scheduler.service';
import { InstanceBackupSettings } from '../instance-backup-settings.entity';
import { InstanceBackupService } from '../instance-backup.service';
import { UpdateInstanceBackupSettingsDto } from './instance-backup-settings.dto';

@Controller('instance/backup-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class InstanceBackupSettingsController {
  constructor(
    private readonly backups: InstanceBackupService,
    private readonly scheduler: InstanceBackupSchedulerService,
  ) {}

  @Get()
  get(): Promise<InstanceBackupSettings> {
    return this.backups.settings();
  }

  @Patch()
  async update(
    @Body() dto: UpdateInstanceBackupSettingsDto,
  ): Promise<InstanceBackupSettings> {
    const cron = dto.backupCron?.trim() || null;
    if (cron && !BackupSchedulerService.isValidCron(cron)) {
      throw new BadRequestException(
        'backupCron is not a valid cron expression',
      );
    }
    const saved = await this.backups.saveSettings({
      ...(dto.backupCron !== undefined ? { backupCron: cron } : {}),
      ...(dto.backupKeep !== undefined ? { backupKeep: dto.backupKeep } : {}),
      ...(dto.destinationId !== undefined
        ? { destinationId: dto.destinationId }
        : {}),
    });
    this.scheduler.reschedule(saved);
    return saved;
  }
}
