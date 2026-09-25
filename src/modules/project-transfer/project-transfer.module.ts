import { Module } from '@nestjs/common';
import { ApplicationModule } from '../application/application.module';
import { BackupDestinationModule } from '../backup-destination/backup-destination.module';
import { ComposeModule } from '../compose/compose.module';
import { DatabaseBackupModule } from '../database-backup/database-backup.module';
import { GitCredentialModule } from '../git-credential/git-credential.module';
import { JobModule } from '../job/job.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { ProjectModule } from '../project/project.module';
import { RegistryModule } from '../registry/registry.module';
import { ServerModule } from '../server/server.module';
import { VolumeBackupModule } from '../volume-backup/volume-backup.module';
import { ExportProjectController } from './export-project/export-project.controller';
import { ExportProjectService } from './export-project/export-project.service';
import { ImportProjectController } from './import-project/import-project.controller';
import { ImportProjectService } from './import-project/import-project.service';
import { ProjectExportService } from './project-export.service';
import { ProjectImportService } from './project-import.service';

/** Export a project's definition to JSON and create a project from one. */
@Module({
  imports: [
    ProjectModule,
    ApplicationModule,
    ManagedDatabaseModule,
    ComposeModule,
    JobModule,
    DatabaseBackupModule,
    VolumeBackupModule,
    RegistryModule,
    GitCredentialModule,
    BackupDestinationModule,
    ServerModule,
  ],
  controllers: [ExportProjectController, ImportProjectController],
  providers: [
    ProjectExportService,
    ProjectImportService,
    ExportProjectService,
    ImportProjectService,
  ],
})
export class ProjectTransferModule {}
