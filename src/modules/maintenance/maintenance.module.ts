import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApplicationModule } from '../application/application.module';
import { ComposeModule } from '../compose/compose.module';
import { DockerModule } from '../docker/docker.module';
import { DomainConflictModule } from '../domain-conflict/domain-conflict.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { RegistryModule } from '../registry/registry.module';
import { ServerModule } from '../server/server.module';
import { DiskUsageController } from './disk-usage/disk-usage.controller';
import { MaintenanceService } from './maintenance.service';
import { RemoveOrphanContainerController } from './remove-orphan-container/remove-orphan-container.controller';
import { RunCleanupController } from './run-cleanup/run-cleanup.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ApplicationModule,
    ComposeModule,
    ManagedDatabaseModule,
    DockerModule,
    RegistryModule,
    ServerModule,
    DomainConflictModule,
  ],
  controllers: [
    DiskUsageController,
    RunCleanupController,
    RemoveOrphanContainerController,
  ],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
