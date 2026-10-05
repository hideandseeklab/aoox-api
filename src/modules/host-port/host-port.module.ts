import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { DatabaseCompanion } from '../database-companion/database-companion.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { HostPortService } from './host-port.service';

/**
 * Only entity classes are registered here (not the feature modules) so this
 * module has no dependency on ApplicationModule/ComposeModule/
 * ManagedDatabaseModule and can be imported by ApplicationModule and
 * ComposeModule alike without creating a cycle (ComposeModule already
 * imports ApplicationModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Application,
      ManagedDatabase,
      ComposeApp,
      DatabaseCompanion,
    ]),
  ],
  providers: [HostPortService],
  exports: [HostPortService],
})
export class HostPortModule {}
