import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CertificateSyncService } from '../../certificate/certificate-sync.service';
import { CertificateService } from '../../certificate/certificate.service';
import { ProxyConfigService } from '../../proxy-config/proxy-config.service';
import { ProxyService } from '../../proxy/proxy.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { proxySettingsOf } from '../../server/server.entity';
import { ServerService } from '../../server/server.service';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
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

    if (dto.certificateId === undefined && dto.middlewares === undefined) {
      throw new BadRequestException('Send certificateId and/or middlewares');
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
    const middlewaresChanged =
      middlewares !== undefined &&
      middlewares.join(',') !== currentMiddlewares.join(',');
    if (previousCertificateId === nextCertificateId && !middlewaresChanged) {
      return toDomainDto(
        domain,
        certificate?.name ??
          (previousCertificateId
            ? await this.nameOf(previousCertificateId)
            : null),
      );
    }
    const certificateChanged = previousCertificateId !== nextCertificateId;
    domain.certificateId = nextCertificateId;
    if (middlewares !== undefined) domain.middlewares = middlewares;
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
        domain.certificate = null;
        await this.applications.domains.save(domain);
        throw new BadGatewayException(
          'The certificate could not be written to the proxy, so the domain was left unchanged; try again',
        );
      }
    }

    // The router labels change (secure vs secure-custom): recreate, no rebuild.
    await this.runner.applyRuntimeConfig(app);
    // Not `domain.certificateId`: TypeORM nulls that field on the entity after
    // `save` because `domain.certificate` is null, although the column was written.
    return toDomainDto(
      { ...domain, certificateId: nextCertificateId },
      certificate?.name ??
        (nextCertificateId ? await this.nameOf(nextCertificateId) : null),
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
