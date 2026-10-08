import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Domain } from '../application/domain.entity';
import { ProxyModule } from '../proxy/proxy.module';
import { ServerModule } from '../server/server.module';
import { CreateProxyConfigController } from './create-proxy-config/create-proxy-config.controller';
import { DeleteProxyConfigController } from './delete-proxy-config/delete-proxy-config.controller';
import { GetProxyConfigController } from './get-proxy-config/get-proxy-config.controller';
import { ListProxyConfigController } from './list-proxy-config/list-proxy-config.controller';
import { ProxyConfigPresetsController } from './proxy-config-presets/proxy-config-presets.controller';
import { ProxyConfigSyncService } from './proxy-config-sync.service';
import { ProxyConfigFile } from './proxy-config.entity';
import { ProxyConfigService } from './proxy-config.service';
import { SyncProxyConfigController } from './sync-proxy-config/sync-proxy-config.controller';
import { UpdateProxyConfigController } from './update-proxy-config/update-proxy-config.controller';

/**
 * Operator-written Traefik dynamic configuration (middlewares, routers,
 * services) per proxy, written to the proxy file-provider directory as
 * `user-*.yml`. Reads the `Domain` entity only (middleware references);
 * imported by the application module, never the reverse. Static controllers
 * (presets, sync) come before the `:id` ones so the path is not taken as an id.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProxyConfigFile, Domain]),
    ProxyModule,
    ServerModule,
  ],
  controllers: [
    ListProxyConfigController,
    ProxyConfigPresetsController,
    SyncProxyConfigController,
    GetProxyConfigController,
    CreateProxyConfigController,
    UpdateProxyConfigController,
    DeleteProxyConfigController,
  ],
  providers: [ProxyConfigService, ProxyConfigSyncService],
  exports: [ProxyConfigService],
})
export class ProxyConfigModule {}
