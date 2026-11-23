import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationModule } from '../application/application.module';
import { Mount } from '../application/mount.entity';
import { ComposeModule } from '../compose/compose.module';
import { DatabaseBackup } from '../database-backup/database-backup.entity';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { ServerModule } from '../server/server.module';
import { VolumeBackup } from '../volume-backup/volume-backup.entity';
import { ApplicationStorageController } from './application-storage/application-storage.controller';
import { ComposeStorageController } from './compose-storage/compose-storage.controller';
import { DatabaseStorageController } from './database-storage/database-storage.controller';
import { DockerDfCacheService } from './docker-df-cache.service';
import { ResourceStorageService } from './resource-storage.service';

/**
 * Disk use per application, database and compose stack. Lives above those
 * modules (it imports them for `findOwnedOrFail`; they never import it), like
 * ProjectDeleteModule, so no module cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Mount, VolumeBackup, DatabaseBackup]),
    ApplicationModule,
    ManagedDatabaseModule,
    ComposeModule,
    ServerModule,
  ],
  controllers: [
    ApplicationStorageController,
    DatabaseStorageController,
    ComposeStorageController,
  ],
  providers: [DockerDfCacheService, ResourceStorageService],
})
export class ResourceStorageModule {}
