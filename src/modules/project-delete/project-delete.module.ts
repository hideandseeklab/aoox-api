import { BackupPurgeModule } from '../backup-purge/backup-purge.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { ApplicationModule } from '../application/application.module';
import { ComposeApp } from '../compose/compose-app.entity';
import { ComposeModule } from '../compose/compose.module';
import { DatabaseBackupModule } from '../database-backup/database-backup.module';
import { DockerModule } from '../docker/docker.module';
import { JobModule } from '../job/job.module';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { ProjectModule } from '../project/project.module';
import { VolumeBackupModule } from '../volume-backup/volume-backup.module';
import { DeleteProjectController } from './delete-project.controller';
import { DeleteProjectService } from './delete-project.service';

/**
 * `DELETE /projects/:id` lives above the application, compose and database
 * modules because it has to tear their workloads down; ProjectModule cannot
 * import them (they import it), so the flow is its own module registered in
 * AppModule, like ProjectTransferModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Application, ComposeApp, ManagedDatabase]),
    DockerModule,
    ProjectModule,
    ApplicationModule,
    ComposeModule,
    ManagedDatabaseModule,
    JobModule,
    VolumeBackupModule,
    DatabaseBackupModule,
    BackupPurgeModule,
  ],
  controllers: [DeleteProjectController],
  providers: [DeleteProjectService],
})
export class ProjectDeleteModule {}
