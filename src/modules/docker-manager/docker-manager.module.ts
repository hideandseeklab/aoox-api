import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { Deployment } from '../application/deployment.entity';
import { PreviewDeployment } from '../application/preview-deployment.entity';
import { Registry } from '../registry/registry.entity';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { ServerModule } from '../server/server.module';
import { ContainerActionController } from './container-action/container-action.controller';
import { ContainerActionService } from './container-action/container-action.service';
import { ContainerLogsController } from './container-logs/container-logs.controller';
import { ContainerLogsService } from './container-logs/container-logs.service';
import { DockerTargetService } from './docker-target.service';
import { ImageProtectionService } from './image-protection.service';
import { ListContainersController } from './list-containers/list-containers.controller';
import { ListContainersService } from './list-containers/list-containers.service';
import { ListImagesController } from './list-images/list-images.controller';
import { ListImagesService } from './list-images/list-images.service';
import { ListOpenPortsController } from './list-open-ports/list-open-ports.controller';
import { ListOpenPortsService } from './list-open-ports/list-open-ports.service';
import { ListNetworksController } from './list-networks/list-networks.controller';
import { ListNetworksService } from './list-networks/list-networks.service';
import { ListVolumesController } from './list-volumes/list-volumes.controller';
import { ListVolumesService } from './list-volumes/list-volumes.service';
import { RemoveContainerController } from './remove-container/remove-container.controller';
import { RemoveContainerService } from './remove-container/remove-container.service';
import { RemoveImageController } from './remove-image/remove-image.controller';
import { RemoveImageService } from './remove-image/remove-image.service';

/**
 * Infrastructure > Docker: see and do the basics on any daemon (host or a
 * remote server). Owner-only writes; aoox's own containers are refused in
 * `DockerTargetService.resolveUnmanaged`.
 */
@Module({
  // Entities only (not their modules) so this module never joins a cycle.
  imports: [
    ServerModule,
    MaintenanceModule,
    TypeOrmModule.forFeature([
      Application,
      Deployment,
      PreviewDeployment,
      Registry,
    ]),
  ],
  controllers: [
    ListContainersController,
    ContainerLogsController,
    ContainerActionController,
    RemoveContainerController,
    ListImagesController,
    RemoveImageController,
    ListVolumesController,
    ListNetworksController,
    ListOpenPortsController,
  ],
  providers: [
    DockerTargetService,
    ImageProtectionService,
    ListContainersService,
    ContainerLogsService,
    ContainerActionService,
    RemoveContainerService,
    ListImagesService,
    RemoveImageService,
    ListVolumesService,
    ListNetworksService,
    ListOpenPortsService,
  ],
})
export class DockerManagerModule {}
