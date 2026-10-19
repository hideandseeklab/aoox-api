import { Module } from '@nestjs/common';
import { DockerModule } from '../docker/docker.module';
import { ProjectModule } from '../project/project.module';
import { ManagedDatabaseModule } from '../managed-database/managed-database.module';
import { DatabaseMountController } from './database-mount.controller';

/** One controller = one flow group (list/add/update/delete mounts of a database). */
@Module({
  imports: [ManagedDatabaseModule, DockerModule, ProjectModule],
  controllers: [DatabaseMountController],
})
export class DatabaseMountModule {}
