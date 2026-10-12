import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import { Domain } from '../application/domain.entity';
import { DnsProviderService } from '../dns-provider/dns-provider.service';
import { ProxyDnsBindingService } from '../dns-provider/proxy-dns-binding.service';
import { ProxyService, ProxySettings } from '../proxy/proxy.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { proxySettingsOf } from '../server/server.entity';
import { ServerService } from '../server/server.service';

export interface ProxyDnsState {
  serverId: string | null;
  connectionId: string | null;
  connectionName: string | null;
  proxy: 'not-installed' | 'running' | 'not-running';
  /** The running proxy container really has the DNS-01 resolver. */
  active: boolean;
  acmeEmail: string | null;
  /** Bound, but the running proxy was created without the resolver (or the reverse). */
  needsRecreate: boolean;
  /** Hosts / apps that currently depend on DNS-01 on this proxy. */
  usedBy: string[];
}

@Injectable()
export class ProxyDnsService {
  private readonly logger = new Logger(ProxyDnsService.name);

  constructor(
    private readonly bindings: ProxyDnsBindingService,
    private readonly providers: DnsProviderService,
    private readonly proxy: ProxyService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
    @InjectRepository(Domain) private readonly domains: Repository<Domain>,
    @InjectRepository(Application)
    private readonly apps: Repository<Application>,
  ) {}

  private async settings(serverId: string | null): Promise<ProxySettings> {
    return serverId
      ? proxySettingsOf(await this.servers.findOrFail(serverId))
      : this.proxy.localSettings;
  }

  async state(serverId: string | null): Promise<ProxyDnsState> {
    if (serverId) await this.servers.findOrFail(serverId);
    const settings = await this.settings(serverId);
    const binding = await this.bindings.get(serverId);
    const connection = binding
      ? await this.providers.repo.findOne({
          where: { id: binding.connectionId },
        })
      : null;
    let status: Awaited<ReturnType<ProxyService['statusOn']>>;
    try {
      const docker = await this.remote.forServer(serverId);
      status = await this.proxy.statusOn(docker, settings);
    } catch (err) {
      this.logger.warn(`Proxy state read failed: ${String(err)}`);
      throw new BadGatewayException(
        'The proxy could not be reached; check that Docker (or the server) is reachable',
      );
    }
    const proxyState = !status.installed
      ? 'not-installed'
      : status.running
        ? 'running'
        : 'not-running';
    return {
      serverId,
      connectionId: binding?.connectionId ?? null,
      connectionName: connection?.name ?? null,
      proxy: proxyState,
      active: status.dnsChallenge,
      acmeEmail: settings.acmeEmail,
      needsRecreate:
        proxyState === 'running' && !!binding !== status.dnsChallenge,
      usedBy: await this.dependents(serverId),
    };
  }

  /** Domains in a DNS certificate mode and apps with wildcard previews on this proxy. */
  async dependents(serverId: string | null): Promise<string[]> {
    const rows = await this.domains
      .createQueryBuilder('d')
      .innerJoin(Application, 'a', 'a.id = d.application_id')
      .select(['d.host'])
      .where("d.cert_mode <> 'http'")
      .andWhere(serverId ? 'a.server_id = :serverId' : 'a.server_id IS NULL', {
        serverId,
      })
      .getMany();
    const previews = await this.apps.find({
      where: { previewWildcardCert: true, serverId: serverId ?? IsNull() },
      select: { appName: true },
    });
    return [
      ...rows.map((d) => d.host),
      ...previews.map((a) => `${a.appName} (previews)`),
    ];
  }

  private async assertRestartAccepted(
    serverId: string | null,
    accepted: boolean,
  ): Promise<void> {
    if (accepted) return;
    const s = await this.state(serverId);
    if (s.proxy === 'running') {
      throw new ConflictException({
        message:
          'Changing DNS-01 recreates the proxy: a few seconds without service for every domain on it (certificates and other routes stay). Confirm to continue.',
        error: 'Conflict',
        statusCode: 409,
        code: 'proxy-restart-required',
      });
    }
  }

  private async recreateIfRunning(serverId: string | null): Promise<void> {
    const settings = await this.settings(serverId);
    const docker = await this.remote.forServer(serverId);
    const status = await this.proxy.statusOn(docker, settings);
    if (status.running) await this.proxy.provisionOn(docker, settings);
  }

  async enable(
    serverId: string | null,
    connectionId: string,
    acceptProxyRestart: boolean,
  ): Promise<ProxyDnsState> {
    if (serverId) await this.servers.findOrFail(serverId);
    await this.providers.findOrFail(connectionId);
    const settings = await this.settings(serverId);
    if (!settings.acmeEmail) {
      throw new BadRequestException(
        serverId
          ? 'Set an ACME email on this server proxy first: DNS-01 uses the same ACME account email'
          : 'Set PROXY_ACME_EMAIL first: DNS-01 uses the same ACME account email',
      );
    }
    const previous = await this.bindings.get(serverId);
    if (
      previous?.connectionId === connectionId &&
      (await this.state(serverId)).active
    ) {
      return this.state(serverId);
    }
    await this.assertRestartAccepted(serverId, acceptProxyRestart);
    await this.bindings.set(serverId, connectionId);
    try {
      await this.recreateIfRunning(serverId);
    } catch (err) {
      this.logger.warn(`Proxy recreate for DNS-01 failed: ${String(err)}`);
      if (previous) await this.bindings.set(serverId, previous.connectionId);
      else await this.bindings.clear(serverId);
      throw new BadGatewayException(
        'The proxy could not be recreated, so DNS-01 was not enabled; nothing changed',
      );
    }
    return this.state(serverId);
  }

  async disable(
    serverId: string | null,
    acceptProxyRestart: boolean,
  ): Promise<ProxyDnsState> {
    if (serverId) await this.servers.findOrFail(serverId);
    const using = await this.dependents(serverId);
    if (using.length > 0) {
      throw new ConflictException(
        `DNS-01 is still used by: ${using.slice(0, 5).join(', ')}${using.length > 5 ? ', ...' : ''}. Switch them back to the automatic certificate first.`,
      );
    }
    const previous = await this.bindings.get(serverId);
    if (!previous) return this.state(serverId);
    await this.assertRestartAccepted(serverId, acceptProxyRestart);
    await this.bindings.clear(serverId);
    try {
      await this.recreateIfRunning(serverId);
    } catch (err) {
      this.logger.warn(`Proxy recreate for DNS-01 failed: ${String(err)}`);
      await this.bindings.set(serverId, previous.connectionId);
      throw new BadGatewayException(
        'The proxy could not be recreated, so DNS-01 was not disabled; nothing changed',
      );
    }
    return this.state(serverId);
  }
}
