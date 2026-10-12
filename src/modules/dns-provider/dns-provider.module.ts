import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Domain } from '../application/domain.entity';
import { CreateDnsConnectionController } from './create-dns-connection/create-dns-connection.controller';
import { DeleteDnsConnectionController } from './delete-dns-connection/delete-dns-connection.controller';
import { DnsProviderConnection } from './dns-provider-connection.entity';
import { DnsProviderService } from './dns-provider.service';
import { ListDnsConnectionsController } from './list-dns-connections/list-dns-connections.controller';
import { ProxyDnsBinding } from './proxy-dns-binding.entity';
import { ProxyDnsBindingService } from './proxy-dns-binding.service';
import { TestDnsConnectionController } from './test-dns-connection/test-dns-connection.controller';

/**
 * DNS provider accounts (Cloudflare). Owns only its entities and the
 * Cloudflare client; it reads the `Domain` entity (delete guard) but imports
 * no feature module, so application, proxy and proxy-dns can import it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DnsProviderConnection, ProxyDnsBinding, Domain]),
  ],
  controllers: [
    CreateDnsConnectionController,
    ListDnsConnectionsController,
    DeleteDnsConnectionController,
    TestDnsConnectionController,
  ],
  providers: [DnsProviderService, ProxyDnsBindingService],
  exports: [DnsProviderService, ProxyDnsBindingService],
})
export class DnsProviderModule {}
