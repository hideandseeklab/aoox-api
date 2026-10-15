import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { ComposeApp } from '../compose/compose-app.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { DomainConflictService } from './domain-conflict.service';

/** Entities only (like HostPortModule), so no cycle with the feature modules. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Application, ManagedDatabase, ComposeApp]),
  ],
  providers: [DomainConflictService],
  exports: [DomainConflictService],
})
export class DomainConflictModule {}
