import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CertificateSyncService } from '../../certificate/certificate-sync.service';
import { CertificateService } from '../../certificate/certificate.service';
import { ProxyDnsBindingService } from '../../dns-provider/proxy-dns-binding.service';
import { ProxyConfigService } from '../../proxy-config/proxy-config.service';
import { ProxyService } from '../../proxy/proxy.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { proxySettingsOf } from '../../server/server.entity';
import { ServerService } from '../../server/server.service';
import { MaintenanceModeService } from '../../maintenance-mode/maintenance-mode.service';
import { ApplicationService } from '../application.service';
import { assertCertMode } from '../cert-mode';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { DomainDnsService } from '../domain-dns.service';
import { DomainDto, toDomainDto } from '../domain-dto';
import { UpdateDomainDto } from './update-domain.dto';

@Injectable()
export class UpdateDomainService {
  private readonly logger = new Logger(UpdateDomainService.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
    private readonly proxy: ProxyService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
    private readonly certs: CertificateService,
    private readonly certSync: CertificateSyncService,
    private readonly proxyConfig: ProxyConfigService,
    private readonly maintenance: MaintenanceModeService,
    private readonly dnsBindings: ProxyDnsBindingService,
    private readonly domainDns: DomainDnsService,
  ) {}

  /**
   * Assigns an uploaded certificate to a domain (null = back to automatic
   * ones) and/or sets its operator middlewares; each part is optional, the
   * labels are rebuilt once for whatever changed.
   */
  async execute(
    ownerId: string,
    applicationId: string,
    domainId: string,
    dto: UpdateDomainDto,
  ): Promise<DomainDto> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    const domain = await this.applications.domains.findOne({
      where: { id: domainId, applicationId: app.id },
    });
    if (!domain) throw new NotFoundException('Domain not found');

    const dnsInput =
      dto.certMode !== undefined ||
      dto.dnsConnectionId !== undefined ||
      dto.dnsProxied !== undefined ||
      dto.dnsOverwrite !== undefined;
    if (
      dto.certificateId === undefined &&
      dto.middlewares === undefined &&
      !dnsInput
    ) {
      throw new BadRequestException(
        'Send certificateId, middlewares, certMode and/or dnsConnectionId',
      );
    }
    const certChange = dto.certificateId !== undefined;
    const certificate =
      certChange && dto.certificateId
        ? await this.certs.findOrFail(dto.certificateId)
        : null;
    if (certificate) {
      if (!domain.https) {
        throw new BadRequestException(
          'A custom certificate needs https enabled on the domain',
        );
      }
      this.certs.assertCovers([domain.host], certificate.domains);
    }
    const middlewares =
      dto.middlewares === undefined ? undefined : [...new Set(dto.middlewares)];
    if (middlewares) {
      await this.proxyConfig.assertMiddlewaresExist(app.serverId, middlewares);
    }
    const previousCertificateId = domain.certificateId ?? null;
    const hadCertificate = previousCertificateId !== null;
    const nextCertificateId = certChange
      ? (certificate?.id ?? null)
      : previousCertificateId;
    const currentMiddlewares = domain.middlewares ?? [];
    const previousCertMode = domain.certMode ?? 'http';
    const nextCertMode = dto.certMode ?? previousCertMode;
    const certModeChanged = nextCertMode !== previousCertMode;
    if (nextCertMode !== 'http') {
      assertCertMode(nextCertMode, {
        host: domain.host,
        https: domain.https,
        hasCustomCertificate: nextCertificateId !== null,
        proxyHasDns: !!(await this.dnsBindings.get(app.serverId)),
      });
    }
    const previousDnsConnection = domain.dnsConnectionId ?? null;
    const nextDnsConnection =
      dto.dnsConnectionId === undefined
        ? previousDnsConnection
        : dto.dnsConnectionId || null;
    if (
      nextDnsConnection &&
      nextDnsConnection !== previousDnsConnection &&
      !(await this.domainDns.connectionName(nextDnsConnection))
    ) {
      throw new BadRequestException('DNS connection not found');
    }
    const nextProxied = dto.dnsProxied ?? domain.dnsProxied ?? false;
    const dnsConnectionChanged = nextDnsConnection !== previousDnsConnection;
    const dnsTouched =
      dnsConnectionChanged ||
      nextProxied !== (domain.dnsProxied ?? false) ||
      dto.dnsOverwrite === true;
    const middlewaresChanged =
      middlewares !== undefined &&
      middlewares.join(',') !== currentMiddlewares.join(',');
    if (
      previousCertificateId === nextCertificateId &&
      !middlewaresChanged &&
      !certModeChanged &&
      !dnsTouched
    ) {
      return toDomainDto(
        domain,
        certificate?.name ??
          (previousCertificateId
            ? await this.nameOf(previousCertificateId)
            : null),
        await this.domainDns.connectionName(previousDnsConnection),
      );
    }
    const certificateChanged = previousCertificateId !== nextCertificateId;
    domain.certificateId = nextCertificateId;
    if (middlewares !== undefined) domain.middlewares = middlewares;
    domain.certMode = nextCertMode;
    // A detached connection's records are removed first, with that connection.
    let dnsCleanupError: string | null = null;
    if (dnsConnectionChanged && previousDnsConnection) {
      dnsCleanupError = await this.domainDns.cleanup(domain);
      domain.dnsRecords = [];
      domain.dnsStatus = null;
      domain.dnsMessage = dnsCleanupError;
    }
    domain.dnsConnectionId = nextDnsConnection;
    domain.dnsProxied = nextProxied;
    domain.certificate = null; // the id column is what is written
    await this.applications.domains.save(domain);

    if (certificateChanged && (certificate || hadCertificate)) {
      const docker = await this.remote.forServer(app.serverId);
      const settings = app.serverId
        ? proxySettingsOf(await this.servers.findOrFail(app.serverId))
        : this.proxy.localSettings;
      if (certificate) {
        // Same rule as add-domain: labels are pointless with no proxy.
        const status = await this.proxy.statusOn(docker, settings);
        if (!status.running) await this.proxy.provisionOn(docker, settings);
      }
      // Writes the certificate (or drops the one no domain uses any more).
      try {
        await this.certSync.sync(docker, settings, app.serverId);
      } catch (err) {
        // The labels were not applied and the files may be stale: put the
        // assignment back so the next deploy does not route to a missing file.
        this.logger.warn(
          `Certificate sync failed for ${domain.host}: ${String(err)}`,
        );
        domain.certificateId = previousCertificateId;
        domain.middlewares = currentMiddlewares;
        domain.certMode = previousCertMode;
        domain.certificate = null;
        await this.applications.domains.save(domain);
        throw new BadGatewayException(
          'The certificate could not be written to the proxy, so the domain was left unchanged; try again',
        );
      }
    }

    // DNS record first, so a certificate requested after the labels change
    // already finds the name. A DNS problem is a warning on the domain, never an error.
    if (nextDnsConnection && dnsTouched) {
      await this.domainDns.sync(app, domain, dto.dnsOverwrite === true);
    }

    if (certificateChanged || middlewaresChanged || certModeChanged) {
      // Certificate, middleware or ACME mode change: the maintenance routers follow it.
      await this.maintenance
        .refresh(app.id)
        .catch((err) =>
          this.logger.warn(
            `Maintenance page for ${domain.host} failed: ${String(err)}`,
          ),
        );
      // The router labels change (secure vs secure-custom): recreate, no rebuild.
      await this.runner.applyRuntimeConfig(app);
    }
    // Not `domain.certificateId`: TypeORM nulls that field on the entity after
    // `save` because `domain.certificate` is null, although the column was written.
    return toDomainDto(
      { ...domain, certificateId: nextCertificateId },
      certificate?.name ??
        (nextCertificateId ? await this.nameOf(nextCertificateId) : null),
      await this.domainDns.connectionName(nextDnsConnection),
    );
  }

  /** Name of the certificate that stays assigned when only middlewares change. */
  private async nameOf(certificateId: string): Promise<string | null> {
    try {
      return (await this.certs.findOrFail(certificateId)).name;
    } catch {
      return null;
    }
  }
}
