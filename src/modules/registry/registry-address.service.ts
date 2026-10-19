import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'net';
import {
  describeRegistryAddress,
  type RegistryAddress,
} from './registry-address';
import { SelfHostedRegistryService } from './self-hosted-registry.service';

const IP_LOOKUP_URL = 'https://api.ipify.org';
const OK_TTL_MS = 10 * 60_000;
/** After a failed lookup do not retry for a while: the status page is polled. */
const FAIL_TTL_MS = 5 * 60_000;

/** Works out the address shown for `docker login`/`push` from other machines. */
@Injectable()
export class RegistryAddressService {
  private readonly logger = new Logger(RegistryAddressService.name);
  private cache: { ip: string | null; at: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly selfHosted: SelfHostedRegistryService,
  ) {}

  /** `publishedOn`: what the running container is bound to (falls back to the env setting). */
  async describe(
    domain: string | null,
    publishedOn?: string | null,
  ): Promise<RegistryAddress> {
    const publishAddress = publishedOn || this.selfHosted.publishAddress;
    const configuredHost = this.config
      .get<string>('REGISTRY_PUBLIC_HOST')
      ?.trim();
    const publicHost =
      configuredHost && configuredHost !== 'localhost' ? configuredHost : null;
    const loopback = describeRegistryAddress({
      domain,
      publishAddress,
      port: this.selfHosted.port,
      publicHost,
      publicIp: null,
    });
    // Nothing to look up for a domain, a local-only binding or an explicit host.
    if (domain || loopback.localOnly || publicHost) return loopback;
    return describeRegistryAddress({
      domain,
      publishAddress,
      port: this.selfHosted.port,
      publicHost,
      publicIp: await this.publicIp(),
    });
  }

  /** `PUBLIC_IP` first, then a cached ipify lookup. Never throws, never slow. */
  private async publicIp(): Promise<string | null> {
    const fromEnv = this.config.get<string>('PUBLIC_IP')?.trim();
    if (fromEnv) return fromEnv;
    const now = Date.now();
    if (this.cache) {
      const ttl = this.cache.ip ? OK_TTL_MS : FAIL_TTL_MS;
      if (now - this.cache.at < ttl) return this.cache.ip;
    }
    try {
      const res = await fetch(IP_LOOKUP_URL, {
        signal: AbortSignal.timeout(3_000),
      });
      const ip = (await res.text()).trim();
      if (!res.ok || !isIP(ip)) throw new Error(`unexpected reply: ${ip}`);
      this.cache = { ip, at: now };
      return ip;
    } catch (err) {
      this.logger.warn(`Public IP detection failed: ${String(err)}`);
      this.cache = { ip: null, at: now };
      return null;
    }
  }
}
