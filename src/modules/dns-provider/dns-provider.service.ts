import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptSecret, encryptSecret } from '../docker/secret.util';
import {
  CLOUDFLARE_API_URL,
  CloudflareClient,
  DnsProviderError,
} from './cloudflare.client';
import { DnsProviderConnection } from './dns-provider-connection.entity';

/** What the API and the web may see: never the token. */
export interface DnsConnectionDto {
  id: string;
  name: string;
  provider: DnsProviderConnection['provider'];
  accountId: string | null;
  createdAt: Date;
}

export interface DnsConnectionTestResult {
  ok: boolean;
  message: string;
  zones: string[];
}

@Injectable()
export class DnsProviderService {
  private readonly key: string;
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(DnsProviderConnection)
    readonly repo: Repository<DnsProviderConnection>,
    config: ConfigService,
  ) {
    this.key = config.getOrThrow<string>('ENCRYPTION_KEY');
    // Override for tests against a fake server; never set it in production.
    this.apiUrl =
      config.get<string>('CLOUDFLARE_API_URL')?.trim() || CLOUDFLARE_API_URL;
  }

  toDto(c: DnsProviderConnection): DnsConnectionDto {
    return {
      id: c.id,
      name: c.name,
      provider: c.provider,
      accountId: c.accountId,
      createdAt: c.createdAt,
    };
  }

  encrypt(token: string): string {
    return encryptSecret(token, this.key);
  }

  async findOrFail(id: string): Promise<DnsProviderConnection> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('DNS connection not found');
    return c;
  }

  /** Decrypted token; only for building a client or the proxy env. */
  async tokenOf(id: string): Promise<string> {
    const c = await this.repo
      .createQueryBuilder('c')
      .addSelect('c.apiTokenEncrypted')
      .where('c.id = :id', { id })
      .getOne();
    if (!c) throw new NotFoundException('DNS connection not found');
    return decryptSecret(c.apiTokenEncrypted, this.key);
  }

  async clientFor(id: string): Promise<CloudflareClient> {
    const c = await this.findOrFail(id);
    return new CloudflareClient(
      await this.tokenOf(id),
      this.apiUrl,
      c.accountId,
    );
  }

  /** Verifies the token and lists the zones it can see. */
  async test(id: string): Promise<DnsConnectionTestResult> {
    try {
      const client = await this.clientFor(id);
      const verified = await client.verifyToken();
      if (verified.status !== 'active') {
        return {
          ok: false,
          message: `Token status: ${verified.status}`,
          zones: [],
        };
      }
      const zones = (await client.listZones()).map((z) => z.name).sort();
      return {
        ok: true,
        message:
          zones.length === 0
            ? 'Token is valid but no zone is accessible (it needs Zone:Read)'
            : `Token is valid, ${zones.length} zone${zones.length === 1 ? '' : 's'} accessible`,
        zones,
      };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof DnsProviderError ? err.message : 'Verification failed',
        zones: [],
      };
    }
  }
}
