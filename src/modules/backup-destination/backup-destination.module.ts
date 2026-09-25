import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { BackupDestination } from './backup-destination.entity';
import { BackupDestinationService } from './backup-destination.service';
import { CreateDestinationController } from './create-destination/create-destination.controller';
import { DeleteDestinationController } from './delete-destination/delete-destination.controller';
import { ListDestinationsController } from './list-destinations/list-destinations.controller';
import { TestDestinationController } from './test-destination/test-destination.controller';

/** Destinations are managed here; the database-backup module decides what to upload. */
@Module({
  imports: [TypeOrmModule.forFeature([BackupDestination]), DockerModule],
  controllers: [
    CreateDestinationController,
    ListDestinationsController,
    DeleteDestinationController,
    TestDestinationController,
  ],
  providers: [BackupDestinationService],
  exports: [BackupDestinationService],
})
export class BackupDestinationModule {}
