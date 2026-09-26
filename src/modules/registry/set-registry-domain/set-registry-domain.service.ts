import { BadRequestException, Injectable } from '@nestjs/common';
import { BackupDestinationService } from '../../backup-destination/backup-destination.service';
import { ProxyService } from '../../proxy/proxy.service';
import { RegistryDto, RegistryService } from '../registry.service';
import { SelfHostedRegistryService } from '../self-hosted-registry.service';
import { SetRegistryDomainDto } from './set-registry-domain.dto';

/**
 * Puts the self-hosted registry behind the built-in proxy on its own domain,
 * so `docker push`/`login` get a trusted cert instead of needing an
 * `insecure-registries` entry on every other Docker daemon (see AGENTS.md
 * "Kredensial untuk klien luar" and the Swarm registry-reachability warning).
 */
@Injectable()
export class SetRegistryDomainService {
  constructor(
    private readonly registries: RegistryService,
    private readonly selfHosted: SelfHostedRegistryService,
    private readonly proxy: ProxyService,
    private readonly destinations: BackupDestinationService,
  ) {}

  async execute(id: string, dto: SetRegistryDomainDto): Promise<RegistryDto> {
    const registry = await this.registries.findOrFail(id);
    if (registry.type !== 'self-hosted') {
      throw new BadRequestException(
        'Only the self-hosted registry can be given a domain',
      );
    }

    const domain = dto.domain?.trim().toLowerCase() ?? null;
    let labels: Record<string, string> = {};
    if (domain) {
      const status = await this.proxy.status();
      if (!status.installed || !status.running) {
        throw new BadRequestException(
          'Provision the reverse proxy first (Settings -> Reverse proxy).',
        );
      }
      if (!status.acmeEmail) {
        throw new BadRequestException(
          'The proxy needs PROXY_ACME_EMAIL set (re-provision it) — without a ' +
            "trusted certificate, docker push/login will reject the registry's domain.",
        );
      }
      labels = ProxyService.buildLabels(
        'aoox-registry',
        5000,
        [{ host: domain, https: true }],
        { httpsPort: status.httpsPort, acme: true },
      );
    }

    const destination = registry.storageDestinationId
      ? (await this.destinations.resolve(registry.storageDestinationId)).config
      : null;
    await this.selfHosted.setDomain(labels, destination);

    registry.domain = domain;
    registry.url = domain ?? this.selfHosted.publicUrl;
    await this.registries.repo.save(registry);
    return this.registries.toDto(registry);
  }
}
