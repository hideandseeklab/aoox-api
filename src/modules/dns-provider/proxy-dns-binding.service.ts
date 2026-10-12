import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { DnsProviderService } from './dns-provider.service';
import { ProxyDnsBinding } from './proxy-dns-binding.entity';

export interface DnsChallengeCredentials {
  provider: 'cloudflare';
  token: string;
}

/** Which DNS connection answers ACME DNS-01 for a proxy (host = null serverId). */
@Injectable()
export class ProxyDnsBindingService {
  constructor(
    @InjectRepository(ProxyDnsBinding)
    readonly repo: Repository<ProxyDnsBinding>,
    private readonly providers: DnsProviderService,
  ) {}

  private where(serverId: string | null) {
    return { serverId: serverId ?? IsNull() };
  }

  get(serverId: string | null): Promise<ProxyDnsBinding | null> {
    return this.repo.findOne({ where: this.where(serverId) });
  }

  async set(serverId: string | null, connectionId: string): Promise<void> {
    const row = await this.get(serverId);
    if (row) {
      row.connectionId = connectionId;
      await this.repo.save(row);
    } else {
      await this.repo.save(this.repo.create({ serverId, connectionId }));
    }
  }

  async clear(serverId: string | null): Promise<void> {
    await this.repo.delete(this.where(serverId));
  }

  /** Token for the proxy env; null when the proxy has no binding. */
  async credentialsFor(
    serverId: string | null | undefined,
  ): Promise<DnsChallengeCredentials | null> {
    const row = await this.get(serverId ?? null);
    if (!row) return null;
    return {
      provider: 'cloudflare',
      token: await this.providers.tokenOf(row.connectionId),
    };
  }
}
