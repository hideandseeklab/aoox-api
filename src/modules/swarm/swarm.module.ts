import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { DockerModule } from '../docker/docker.module';
import { ProxyModule } from '../proxy/proxy.module';
import { RegistryModule } from '../registry/registry.module';
import { InitSwarmController } from './init-swarm/init-swarm.controller';
import { LeaveSwarmController } from './leave-swarm/leave-swarm.controller';
import { RemoveNodeController } from './remove-node/remove-node.controller';
import { SwarmStatusController } from './swarm-status/swarm-status.controller';
import { SwarmService } from './swarm.service';
import { UpdateNodeController } from './update-node/update-node.controller';

/**
 * Docker Swarm on the host daemon. Imports only the Application *entity*
 * (count of service-mode apps), not ApplicationModule — the runner imports
 * this module for `SwarmService`, so the other direction would be a cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Application]),
    DockerModule,
    ProxyModule,
    RegistryModule,
  ],
  controllers: [
    SwarmStatusController,
    InitSwarmController,
    LeaveSwarmController,
    UpdateNodeController,
    RemoveNodeController,
  ],
  providers: [SwarmService],
  exports: [SwarmService],
})
export class SwarmModule {}
