import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ApplicationModule } from '../application/application.module';
import { ComposeModule } from '../compose/compose.module';
import { DockerModule } from '../docker/docker.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { RegistryModule } from '../registry/registry.module';
import { ServerModule } from '../server/server.module';
import { DiskUsageController } from './disk-usage/disk-usage.controller';
import { MaintenanceService } from './maintenance.service';
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
  ],
  controllers: [DiskUsageController, RunCleanupController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
