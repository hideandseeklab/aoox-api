import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CertificateSyncService } from '../../certificate/certificate-sync.service';
import { CertificateService } from '../../certificate/certificate.service';
import { ProxyService } from '../../proxy/proxy.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { proxySettingsOf } from '../../server/server.entity';
import { ServerService } from '../../server/server.service';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { DomainDto, toDomainDto } from '../domain-dto';
import { AddDomainDto } from './add-domain.dto';

export interface AddDomainResult {
  domain: DomainDto;
  /**
   * True when the proxy for this app's daemon (host, or the app's remote
   * server) wasn't running yet, so it was provisioned automatically here —
   * same reasoning as `PanelDomainService`: the Traefik labels
   * `applyRuntimeConfig` is about to apply are pointless with nothing
   * listening on 80/443. A proxy that's already running is left untouched.
   */
  proxyAutoProvisioned: boolean;
}

@Injectable()
export class AddDomainService {
  private readonly logger = new Logger(AddDomainService.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
    private readonly proxy: ProxyService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
    private readonly certs: CertificateService,
    private readonly certSync: CertificateSyncService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
    dto: AddDomainDto,
  ): Promise<AddDomainResult> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    const host = dto.host.trim().toLowerCase();
    if (await this.applications.domains.findOne({ where: { host } })) {
      throw new ConflictException(
        `${host} is already used by another application`,
      );
    }
    // A certificate only makes sense on an https host and must cover it;
    // checked before anything is saved.
    const certificate = dto.certificateId
      ? await this.certs.findOrFail(dto.certificateId)
      : null;
    if (certificate) {
      if (!dto.https) {
        throw new BadRequestException(
          'A custom certificate needs https enabled on the domain',
        );
      }
      this.certs.assertCovers([host], certificate.domains);
    }
    const domain = await this.applications.domains.save(
      this.applications.domains.create({
        applicationId: app.id,
        host,
        https: dto.https ?? false,
        certificateId: certificate?.id ?? null,
      }),
    );

    const docker = await this.remote.forServer(app.serverId);
    const settings = app.serverId
      ? proxySettingsOf(await this.servers.findOrFail(app.serverId))
      : this.proxy.localSettings;
    const proxyStatus = await this.proxy.statusOn(docker, settings);
    const proxyAutoProvisioned = !proxyStatus.running;
    if (proxyAutoProvisioned) {
      await this.proxy.provisionOn(docker, settings);
    }
    // The certificate must be in the proxy's volume (and the proxy able to
    // load it) before the router that refers to it appears.
    if (certificate) {
      try {
        await this.certSync.sync(docker, settings, app.serverId);
      } catch (err) {
        // Without the file the router would serve Traefik's self-signed
        // default: do not leave a domain that points at a missing certificate.
        this.logger.warn(`Certificate sync failed for ${host}: ${String(err)}`);
        await this.applications.domains.remove(domain);
        throw new BadGatewayException(
          'The certificate could not be written to the proxy, so the domain was not added; try again',
        );
      }
    }

    // Labels live on the container, so apply by recreating it (no rebuild).
    await this.runner.applyRuntimeConfig(app);
    return {
      domain: toDomainDto(domain, certificate?.name ?? null),
      proxyAutoProvisioned,
    };
  }
}
