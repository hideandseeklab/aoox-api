import { ConflictException, Injectable } from '@nestjs/common';
import { ProxyService } from '../../proxy/proxy.service';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { proxySettingsOf } from '../../server/server.entity';
import { ServerService } from '../../server/server.service';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { Domain } from '../domain.entity';
import { AddDomainDto } from './add-domain.dto';

export interface AddDomainResult {
  domain: Domain;
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
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
    private readonly proxy: ProxyService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
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
    const domain = await this.applications.domains.save(
      this.applications.domains.create({
        applicationId: app.id,
        host,
        https: dto.https ?? false,
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

    // Labels live on the container, so apply by recreating it (no rebuild).
    await this.runner.applyRuntimeConfig(app);
    return { domain, proxyAutoProvisioned };
  }
}
