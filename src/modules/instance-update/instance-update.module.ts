import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { ApplyInstanceUpdateController } from './apply-instance-update.controller';
import { GetInstanceUpdateController } from './get-instance-update.controller';
import { InstanceUpdateState } from './instance-update-state.entity';
import { InstanceUpdateService } from './instance-update.service';

/** Checks for and applies aoox-api/aoox-web image updates (owner only). */
@Module({
  imports: [TypeOrmModule.forFeature([InstanceUpdateState]), DockerModule],
  controllers: [GetInstanceUpdateController, ApplyInstanceUpdateController],
  providers: [InstanceUpdateService],
})
export class InstanceUpdateModule {}
