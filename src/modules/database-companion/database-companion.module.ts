import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Domain } from '../application/domain.entity';
import { DockerModule } from '../docker/docker.module';
import { HostPortModule } from '../host-port/host-port.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { ProjectModule } from '../project/project.module';
import { ProxyModule } from '../proxy/proxy.module';
import { CompanionCredentialsController } from './companion-credentials/companion-credentials.controller';
import { CompanionOptionsController } from './companion-options/companion-options.controller';
import { CreateCompanionController } from './create-companion/create-companion.controller';
import { DatabaseCompanion } from './database-companion.entity';
import { DatabaseCompanionService } from './database-companion.service';
import { DeleteCompanionController } from './delete-companion/delete-companion.controller';
import { GetCompanionController } from './get-companion/get-companion.controller';

/**
 * Not imported by ManagedDatabaseModule (that would cycle): deleting a
 * database removes the companion container by name in
 * `ManagedDatabaseService.remove`, and the row goes with the database
 * through the FK cascade.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DatabaseCompanion, Domain]),
    DockerModule,
    ProxyModule,
    ProjectModule,
    HostPortModule,
    ManagedDatabaseModule,
  ],
  controllers: [
    GetCompanionController,
    CompanionOptionsController,
    CreateCompanionController,
    CompanionCredentialsController,
    DeleteCompanionController,
  ],
  providers: [DatabaseCompanionService],
})
export class DatabaseCompanionModule {}
