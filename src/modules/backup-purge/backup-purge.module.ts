import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackupDestinationModule } from '../backup-destination/backup-destination.module';
import { DatabaseBackup } from '../database-backup/database-backup.entity';
import { DockerModule } from '../docker/docker.module';
import { ServerModule } from '../server/server.module';
import { VolumeBackup } from '../volume-backup/volume-backup.entity';
import { BackupPurgeService } from './backup-purge.service';

/**
 * Leaf module (entities only, no backup or workload module) so both the
 * database and the application delete flows can import it without a cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DatabaseBackup, VolumeBackup]),
    DockerModule,
    BackupDestinationModule,
    ServerModule,
  ],
  providers: [BackupPurgeService],
  exports: [BackupPurgeService],
})
export class BackupPurgeModule {}
