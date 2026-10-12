import { Injectable, Logger } from '@nestjs/common';
import {
  DnsSyncOutcome,
  removeManagedRecords,
  syncHostRecord,
} from '../dns-provider/dns-records';
import { DnsProviderService } from '../dns-provider/dns-provider.service';
import { Application } from './application.entity';
import { ApplicationService } from './application.service';
import { CheckDomainDnsService } from './check-domain-dns/check-domain-dns.service';
import { Domain } from './domain.entity';

/**
 * Keeps a domain's DNS record in the DNS provider in step with the domain.
 * Nothing here ever throws into the caller: a DNS problem is a warning on the
 * domain, never a failed add-domain/update-domain.
 */
@Injectable()
export class DomainDnsService {
  private readonly logger = new Logger(DomainDnsService.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly check: CheckDomainDnsService,
    private readonly providers: DnsProviderService,
  ) {}

  /** Creates/updates the record and stores the outcome on the domain row. */
  async sync(
    app: Application,
    domain: Domain,
    overwrite: boolean,
  ): Promise<DnsSyncOutcome | null> {
    if (!domain.dnsConnectionId) return null;
    let outcome: DnsSyncOutcome;
    try {
      const expected = await this.check.expectedIp(app);
      if (!expected) {
        outcome = {
          status: 'warning',
          message:
            'Could not tell which IP this domain should point at (set PUBLIC_IP, or check that the public IP lookup works); no record was written',
          records: domain.dnsRecords ?? [],
        };
      } else {
        const client = await this.providers.clientFor(domain.dnsConnectionId);
        outcome = await syncHostRecord(client, domain.host, expected.ip, {
          proxied: domain.dnsProxied,
          overwrite,
          owned: domain.dnsRecords ?? [],
        });
      }
    } catch (err) {
      this.logger.warn(`DNS sync for ${domain.host} failed: ${String(err)}`);
      outcome = {
        status: 'error',
        message: 'DNS provider connection could not be used',
        records: domain.dnsRecords ?? [],
      };
    }
    if (outcome.status !== 'ok') {
      this.logger.warn(`DNS for ${domain.host}: ${outcome.message}`);
    }
    domain.dnsRecords = outcome.records;
    domain.dnsStatus = outcome.status;
    domain.dnsMessage = outcome.message;
    await this.applications.domains.update(domain.id, {
      dnsRecords: outcome.records,
      dnsStatus: outcome.status,
      dnsMessage: outcome.message,
    });
    return outcome;
  }

  /**
   * Deletes exactly the records aoox created for this domain and clears the
   * bookkeeping. Returns an error text when something could not be removed.
   */
  async cleanup(domain: Domain): Promise<string | null> {
    const records = domain.dnsRecords ?? [];
    if (!domain.dnsConnectionId || records.length === 0) return null;
    try {
      const client = await this.providers.clientFor(domain.dnsConnectionId);
      const { errors } = await removeManagedRecords(client, records);
      if (errors.length > 0) {
        const msg = `Some DNS records were not removed: ${errors.join('; ')}`;
        this.logger.warn(`${domain.host}: ${msg}`);
        return msg;
      }
      return null;
    } catch (err) {
      this.logger.warn(`DNS cleanup for ${domain.host} failed: ${String(err)}`);
      return 'DNS records could not be removed (connection unavailable)';
    }
  }

  async connectionName(id: string | null): Promise<string | null> {
    if (!id) return null;
    const c = await this.providers.repo.findOne({
      where: { id },
      select: { id: true, name: true },
    });
    return c?.name ?? null;
  }
}
