import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import { ServerService } from '../../server/server.service';
import { Application } from '../application.entity';
import { DnsCheckDto, DnsStatus } from './check-domain-dns.dto';

/** Where the public IP is looked up when PUBLIC_IP is not set (plain-text body). */
const IP_LOOKUP_URL = 'https://api.ipify.org';
const IP_CACHE_MS = 10 * 60_000;

/**
 * On-demand DNS check for a domain: resolves the
 * host and compares with where traffic must land — this host's public IP,
 * or the remote server the application runs on. Nothing is persisted; DNS
 * changes on its own schedule, so the web asks when the user clicks.
 */
@Injectable()
export class CheckDomainDnsService {
  private readonly logger = new Logger(CheckDomainDnsService.name);
  private detected: { ip: string; at: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly servers: ServerService,
  ) {}

  async execute(app: Application, host: string): Promise<DnsCheckDto> {
    const [expected, records] = await Promise.all([
      this.expectedIp(app),
      CheckDomainDnsService.lookup(host),
    ]);
    const status = CheckDomainDnsService.evaluate(
      records.addresses,
      expected?.ip ?? null,
    );
    return {
      host,
      status,
      expectedIp: expected?.ip ?? null,
      expectedSource: expected?.source ?? null,
      addresses: records.addresses,
      cname: records.cname,
      message: CheckDomainDnsService.describe(status, records, expected?.ip),
    };
  }

  /** Pure so the verdict can be unit-tested without DNS. */
  static evaluate(addresses: string[], expectedIp: string | null): DnsStatus {
    if (addresses.length === 0) return 'unresolved';
    if (!expectedIp) return 'unknown';
    return addresses.includes(expectedIp) ? 'ok' : 'mismatch';
  }

  static describe(
    status: DnsStatus,
    records: { addresses: string[]; cname: string | null },
    expectedIp: string | null | undefined,
  ): string {
    const via = records.cname ? ` (CNAME → ${records.cname})` : '';
    switch (status) {
      case 'ok':
        return `Points at ${expectedIp}${via}`;
      case 'mismatch':
        return `Resolves to ${records.addresses.join(', ')}${via}, expected ${expectedIp}`;
      case 'unresolved':
        return 'No A/AAAA record found — DNS not set up yet or still propagating';
      case 'unknown':
        return `Resolves to ${records.addresses.join(', ')}${via}; set PUBLIC_IP to compare`;
    }
  }

  /** A + AAAA (Node follows CNAMEs for these) and the CNAME itself for display. */
  static async lookup(
    host: string,
  ): Promise<{ addresses: string[]; cname: string | null }> {
    const quiet = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);
    const [a, aaaa, cname] = await Promise.all([
      quiet(dns.resolve4(host)),
      quiet(dns.resolve6(host)),
      quiet(dns.resolveCname(host)),
    ]);
    return { addresses: [...a, ...aaaa], cname: cname[0] ?? null };
  }

  private async expectedIp(
    app: Application,
  ): Promise<{ ip: string; source: DnsCheckDto['expectedSource'] } | null> {
    if (app.serverId) {
      const server = await this.servers.findOrFail(app.serverId);
      if (isIP(server.host)) return { ip: server.host, source: 'server' };
      const { addresses } = await CheckDomainDnsService.lookup(server.host);
      return addresses[0] ? { ip: addresses[0], source: 'server' } : null;
    }
    const fromEnv = this.config.get<string>('PUBLIC_IP')?.trim();
    if (fromEnv) return { ip: fromEnv, source: 'env' };
    const detected = await this.detectPublicIp();
    return detected ? { ip: detected, source: 'detected' } : null;
  }

  /** Cached; a failed lookup just yields `unknown` rather than an error. */
  private async detectPublicIp(): Promise<string | null> {
    if (this.detected && Date.now() - this.detected.at < IP_CACHE_MS) {
      return this.detected.ip;
    }
    try {
      const res = await fetch(IP_LOOKUP_URL, {
        signal: AbortSignal.timeout(5_000),
      });
      const ip = (await res.text()).trim();
      if (!res.ok || !isIP(ip)) throw new Error(`unexpected reply: ${ip}`);
      this.detected = { ip, at: Date.now() };
      return ip;
    } catch (err) {
      this.logger.warn(`Public IP detection failed: ${String(err)}`);
      return null;
    }
  }
}
