import { Module } from '@nestjs/common';
import { DockerModule } from '../docker/docker.module';
import { GetInstanceEnvController } from './get-instance-env.controller';
import { InstanceEnvService } from './instance-env.service';
import { UpdateInstanceEnvController } from './update-instance-env.controller';

/** Dashboard-editable subset of the panel's own .env.dist (owner only). */
@Module({
  imports: [DockerModule],
  controllers: [GetInstanceEnvController, UpdateInstanceEnvController],
  providers: [InstanceEnvService],
})
export class InstanceEnvModule {}
