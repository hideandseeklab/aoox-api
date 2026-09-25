import { Module } from '@nestjs/common';
import { DockerModule } from '../docker/docker.module';
import { ProvisionProxyController } from './provision-proxy/provision-proxy.controller';
import { ProvisionProxyService } from './provision-proxy/provision-proxy.service';
import { ProxyStatusController } from './proxy-status/proxy-status.controller';
import { ProxyService } from './proxy.service';
import { RemoveProxyController } from './remove-proxy/remove-proxy.controller';

@Module({
  imports: [DockerModule],
  controllers: [
    ProxyStatusController,
    ProvisionProxyController,
    RemoveProxyController,
  ],
  providers: [ProxyService, ProvisionProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
