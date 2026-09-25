import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mount } from '../application/mount.entity';
import { DockerModule } from '../docker/docker.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { SwarmModule } from '../swarm/swarm.module';
import { ProjectModule } from '../project/project.module';
import { CreateDatabaseController } from './create-database/create-database.controller';
import { CreateDatabaseService } from './create-database/create-database.service';
import { DatabaseMetricsController } from './database-metrics/database-metrics.controller';
import { DatabaseCredentialsController } from './database-credentials/database-credentials.controller';
import { DeleteDatabaseController } from './delete-database/delete-database.controller';
import { GetDatabaseController } from './get-database/get-database.controller';
import { GetDatabaseService } from './get-database/get-database.service';
import { ListDatabasesController } from './list-databases/list-databases.controller';
import { ManagedDatabase } from './managed-database.entity';
import { ManagedDatabaseService } from './managed-database.service';
import { StartDatabaseController } from './start-database/start-database.controller';
import { UpdateDatabaseController } from './update-database/update-database.controller';
import { DataBrowserController } from './data-browser/data-browser.controller';
import { DatabaseQueryService } from './data-browser/database-query.service';
import { QueryHistoryController } from './query-history/query-history.controller';
import { QueryHistoryEntry } from './query-history/query-history.entity';
import { QueryHistoryService } from './query-history/query-history.service';
import { SchemasController } from './schemas/schemas.controller';
import { SchemasService } from './schemas/schemas.service';
import { StopDatabaseController } from './stop-database/stop-database.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ManagedDatabase, Mount, QueryHistoryEntry]),
    DockerModule,
    ProjectModule,
    MonitoringModule,
    SwarmModule,
  ],
  controllers: [
    CreateDatabaseController,
    ListDatabasesController,
    GetDatabaseController,
    DatabaseCredentialsController,
    DeleteDatabaseController,
    StartDatabaseController,
    UpdateDatabaseController,
    DataBrowserController,
    QueryHistoryController,
    SchemasController,
    StopDatabaseController,
    DatabaseMetricsController,
  ],
  providers: [
    ManagedDatabaseService,
    CreateDatabaseService,
    GetDatabaseService,
    DatabaseQueryService,
    QueryHistoryService,
    SchemasService,
  ],
  exports: [ManagedDatabaseService],
})
export class ManagedDatabaseModule {}
