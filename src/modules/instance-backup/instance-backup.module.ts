import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackupDestinationModule } from '../backup-destination/backup-destination.module';
import { DatabaseBackupModule } from '../database-backup/database-backup.module';
import { DockerModule } from '../docker/docker.module';
import { JobModule } from '../job/job.module';
import { NotificationModule } from '../notification/notification.module';
import { ServerModule } from '../server/server.module';
import { VolumeBackupModule } from '../volume-backup/volume-backup.module';
import { CreateInstanceBackupController } from './create-instance-backup/create-instance-backup.controller';
import { DeleteInstanceBackupController } from './delete-instance-backup/delete-instance-backup.controller';
import { DownloadInstanceBackupController } from './download-instance-backup/download-instance-backup.controller';
import { InstanceBackupSchedulerService } from './instance-backup-scheduler.service';
import { InstanceBackupSettingsController } from './instance-backup-settings/instance-backup-settings.controller';
import { InstanceBackupSettings } from './instance-backup-settings.entity';
import { InstanceBackup } from './instance-backup.entity';
import { InstanceBackupService } from './instance-backup.service';
import { ListInstanceBackupsController } from './list-instance-backups/list-instance-backups.controller';
import { RestoreInstanceBackupController } from './restore-instance-backup/restore-instance-backup.controller';
import { RestoreInstanceUploadController } from './restore-instance-upload/restore-instance-upload.controller';

/** Snapshot/restore of the panel's own database (owner only). */
@Module({
  imports: [
    TypeOrmModule.forFeature([InstanceBackup, InstanceBackupSettings]),
    DockerModule,
    BackupDestinationModule,
    DatabaseBackupModule,
    VolumeBackupModule,
    JobModule,
    NotificationModule,
    ServerModule,
  ],
  controllers: [
    CreateInstanceBackupController,
    ListInstanceBackupsController,
    RestoreInstanceBackupController,
    RestoreInstanceUploadController,
    DownloadInstanceBackupController,
    DeleteInstanceBackupController,
    InstanceBackupSettingsController,
  ],
  providers: [InstanceBackupService, InstanceBackupSchedulerService],
})
export class InstanceBackupModule {}
