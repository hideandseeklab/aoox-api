import { Module } from '@nestjs/common';
import { ProjectModule } from '../project/project.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackupDestinationModule } from '../backup-destination/backup-destination.module';
import { DockerModule } from '../docker/docker.module';
import { NotificationModule } from '../notification/notification.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { BackupFilesService } from './backup-files.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { CreateBackupController } from './create-backup/create-backup.controller';
import { DatabaseBackup } from './database-backup.entity';
import { DatabaseBackupService } from './database-backup.service';
import { DeleteBackupController } from './delete-backup/delete-backup.controller';
import { DownloadBackupController } from './download-backup/download-backup.controller';
import { ListBackupsController } from './list-backups/list-backups.controller';
import { RestoreBackupController } from './restore-backup/restore-backup.controller';
import { UpdateBackupScheduleController } from './update-backup-schedule/update-backup-schedule.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([DatabaseBackup]),
    ScheduleModule.forRoot(),
    DockerModule,
    ManagedDatabaseModule,
    NotificationModule,
    BackupDestinationModule,
    ProjectModule,
  ],
  controllers: [
    CreateBackupController,
    ListBackupsController,
    RestoreBackupController,
    DownloadBackupController,
    DeleteBackupController,
    UpdateBackupScheduleController,
  ],
  providers: [
    DatabaseBackupService,
    BackupSchedulerService,
    BackupFilesService,
  ],
  exports: [BackupFilesService, BackupSchedulerService],
})
export class DatabaseBackupModule {}
