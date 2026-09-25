import { Module } from '@nestjs/common';
import { DockerEventsService } from './docker-events.service';
import { DockerService } from './docker.service';

@Module({
  providers: [DockerService, DockerEventsService],
  exports: [DockerService, DockerEventsService],
})
export class DockerModule {}
