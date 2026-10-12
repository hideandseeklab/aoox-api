import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Application } from '../application/application.entity';
import { Domain } from '../application/domain.entity';
import { DnsProviderModule } from '../dns-provider/dns-provider.module';
import { ProxyModule } from '../proxy/proxy.module';
import { ServerModule } from '../server/server.module';
import { ClearProxyDnsController } from './clear-proxy-dns/clear-proxy-dns.controller';
import { GetProxyDnsController } from './get-proxy-dns/get-proxy-dns.controller';
import { ProxyDnsService } from './proxy-dns.service';
import { SetProxyDnsController } from './set-proxy-dns/set-proxy-dns.controller';

/**
 * ACME DNS-01 for a proxy: binds a DNS connection to the host proxy or a
 * remote server proxy. Reads the application/domain entities only; imported
 * by AppModule, never by the application module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Domain, Application]),
    DnsProviderModule,
    ProxyModule,
    ServerModule,
  ],
  controllers: [
    GetProxyDnsController,
    SetProxyDnsController,
    ClearProxyDnsController,
  ],
  providers: [ProxyDnsService],
})
export class ProxyDnsModule {}
