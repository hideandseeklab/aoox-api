import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mount } from '../application/mount.entity';
import { ComposeModule } from '../compose/compose.module';
import { DockerModule } from '../docker/docker.module';
import { ComposeMountController } from './compose-mount.controller';

/** One controller = one flow group (list/add/update/delete mounts of a compose stack). */
@Module({
  imports: [TypeOrmModule.forFeature([Mount]), ComposeModule, DockerModule],
  controllers: [ComposeMountController],
})
export class ComposeMountModule {}
