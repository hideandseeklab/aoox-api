import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { ApplyInstanceUpdateController } from './apply-instance-update.controller';
import { GetInstanceUpdateController } from './get-instance-update.controller';
import { GetInstanceUpdateProgressController } from './get-instance-update-progress.controller';
import { InstanceUpdateState } from './instance-update-state.entity';
import { InstanceUpdateService } from './instance-update.service';
import { InstanceVersionService } from './instance-version.service';

/** Checks for and applies aoox-api/aoox-web image updates (owner only). */
@Module({
  imports: [TypeOrmModule.forFeature([InstanceUpdateState]), DockerModule],
  controllers: [
    GetInstanceUpdateController,
    GetInstanceUpdateProgressController,
    ApplyInstanceUpdateController,
  ],
  providers: [InstanceUpdateService, InstanceVersionService],
  exports: [InstanceVersionService],
})
export class InstanceUpdateModule {}
