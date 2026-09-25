import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../../managed-database/get-database/get-database.dto';
import { ManagedDatabase } from '../../managed-database/managed-database.entity';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { BackupDestinationService } from '../../backup-destination/backup-destination.service';
import { BackupSchedulerService } from '../backup-scheduler.service';
import { UpdateBackupScheduleDto } from './update-backup-schedule.dto';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class UpdateBackupScheduleController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly scheduler: BackupSchedulerService,
    private readonly destinations: BackupDestinationService,
  ) {}

  @Patch(':id/backup-schedule')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: UpdateBackupScheduleDto,
  ): Promise<ManagedDatabase> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    if (dto.backupCron !== undefined) {
      if (
        dto.backupCron &&
        !BackupSchedulerService.isValidCron(dto.backupCron)
      ) {
        throw new BadRequestException('Invalid cron expression');
      }
      db.backupCron = dto.backupCron;
    }
    if (dto.backupKeep !== undefined) db.backupKeep = dto.backupKeep;
    if (dto.backupAllDatabases !== undefined)
      db.backupAllDatabases = dto.backupAllDatabases;
    if (dto.backupDestinationId !== undefined) {
      if (dto.backupDestinationId)
        await this.destinations.findOrFail(dto.backupDestinationId); // 404
      db.backupDestinationId = dto.backupDestinationId;
    }
    const saved = await this.databases.repo.save(db);
    this.scheduler.reschedule(saved);
    return saved;
  }
}
