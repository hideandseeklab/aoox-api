import { Module } from '@nestjs/common';
import { ProjectModule } from '../project/project.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationModule } from '../application/application.module';
import { BackupDestinationModule } from '../backup-destination/backup-destination.module';
import { DatabaseBackupModule } from '../database-backup/database-backup.module';
import { DockerModule } from '../docker/docker.module';
import { NotificationModule } from '../notification/notification.module';
import { ServerModule } from '../server/server.module';
import { CreateVolumeBackupController } from './create-volume-backup/create-volume-backup.controller';
import { DeleteVolumeBackupController } from './delete-volume-backup/delete-volume-backup.controller';
import { DownloadVolumeBackupController } from './download-volume-backup/download-volume-backup.controller';
import { ListVolumeBackupsController } from './list-volume-backups/list-volume-backups.controller';
import { RestoreVolumeBackupController } from './restore-volume-backup/restore-volume-backup.controller';
import { UpdateVolumeBackupScheduleController } from './update-volume-backup-schedule/update-volume-backup-schedule.controller';
import { VolumeBackupSchedulerService } from './volume-backup-scheduler.service';
import { VolumeBackup } from './volume-backup.entity';
import { VolumeBackupService } from './volume-backup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VolumeBackup]),
    ScheduleModule.forRoot(),
    ApplicationModule,
    DockerModule,
    BackupDestinationModule,
    NotificationModule,
    ServerModule,
    // BackupFilesService (local presence + pull from S3).
    DatabaseBackupModule,
    ProjectModule,
  ],
  controllers: [
    CreateVolumeBackupController,
    ListVolumeBackupsController,
    RestoreVolumeBackupController,
    DownloadVolumeBackupController,
    DeleteVolumeBackupController,
    UpdateVolumeBackupScheduleController,
  ],
  providers: [VolumeBackupService, VolumeBackupSchedulerService],
  exports: [VolumeBackupSchedulerService],
})
export class VolumeBackupModule {}
