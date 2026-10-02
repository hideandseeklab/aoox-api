import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerModule } from '../docker/docker.module';
import { NotificationModule } from '../notification/notification.module';
import { SshModule } from '../ssh/ssh.module';
import { CreateServerController } from './create-server/create-server.controller';
import { CreateServerService } from './create-server/create-server.service';
import { DeleteServerController } from './delete-server/delete-server.controller';
import { ListServersController } from './list-servers/list-servers.controller';
import { RemoteDockerService } from './remote-docker.service';
import { RemoteEventsService } from './remote-events.service';
import { ServerHealthService } from './server-health.service';
import { PlatformSshKeyController } from './platform-ssh-key/platform-ssh-key.controller';
import { Server } from './server.entity';
import { ServerService } from './server.service';
import { ProxyModule } from '../proxy/proxy.module';
import { ServerProxyController } from './server-proxy/server-proxy.controller';
import { TestServerController } from './test-server/test-server.controller';
import { TestServerService } from './test-server/test-server.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Server]),
    ScheduleModule.forRoot(),
    NotificationModule,
    SshModule,
    DockerModule,
    ProxyModule,
  ],
  controllers: [
    // Static route before ':id' routes so "ssh-key" is not read as an id.
    PlatformSshKeyController,
    ServerProxyController,
    CreateServerController,
    ListServersController,
    DeleteServerController,
    TestServerController,
  ],
  providers: [
    ServerService,
    RemoteDockerService,
    RemoteEventsService,
    ServerHealthService,
    CreateServerService,
    TestServerService,
  ],
  exports: [ServerService, RemoteDockerService, RemoteEventsService],
})
export class ServerModule {}
