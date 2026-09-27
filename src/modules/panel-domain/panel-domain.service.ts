import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { envUpsertLine, runComposeHelper } from '../docker/compose-apply.util';
import { DockerService } from '../docker/docker.service';
import { ProxyService } from '../proxy/proxy.service';
import {
  PANEL_DOMAIN_SETTINGS_ID,
  PanelDomainSettings,
} from './panel-domain-settings.entity';
import { renderPanelOverride } from './panel-domain.util';
import { UpdatePanelDomainDto } from './update-panel-domain.dto';

const OVERRIDE_FILE = 'docker-compose.override.yml';

export interface PanelDomainStatus {
  settings: PanelDomainSettings;
  applied: { webOrigin: string | null; publicApiUrl: string | null };
  installDirConfigured: boolean;
}

export interface UpdatePanelDomainResult {
  settings: PanelDomainSettings;
  /**
   * True when the proxy wasn't running at the moment this was saved, so
   * `apply()` provisioned it automatically. Surfaced to the dashboard as a
   * warning (with manual troubleshooting steps) rather than staying silent,
   * since auto-provisioning the proxy container doesn't guarantee the domain
   * is actually reachable yet — DNS may not have propagated, or the host's
   * firewall/cloud security group may still be blocking ports 80/443.
   */
  proxyAutoProvisioned: boolean;
}

/**
 * Lets the owner point the panel's own `web`/`api` containers at a custom
 * domain from the running dashboard, instead of hand-editing
 * `docker-compose.domain.yml`/`.env.dist` and re-running `docker compose up`
 * over SSH (see AGENTS.md "Domain untuk panel sendiri"). Applying it recreates
 * the `web` and `api` containers themselves — including the one serving this
 * very request — so `apply()` is fired detached after the settings row is
 * saved, giving the HTTP response time to flush before the panel restarts.
 */
@Injectable()
export class PanelDomainService {
  private readonly logger = new Logger(PanelDomainService.name);

  constructor(
    @InjectRepository(PanelDomainSettings)
    private readonly repo: Repository<PanelDomainSettings>,
    private readonly docker: DockerService,
    private readonly config: ConfigService,
    private readonly proxy: ProxyService,
  ) {}

  /** Absolute path, on the host, of the directory holding docker-compose.dist.yml. */
  private get installDir(): string | null {
    return this.config.get<string>('INSTALL_DIR')?.trim() || null;
  }

  async status(): Promise<PanelDomainStatus> {
    return {
      settings: await this.settings(),
      applied: {
        webOrigin: this.config.get<string>('WEB_ORIGIN') ?? null,
        publicApiUrl: this.config.get<string>('PUBLIC_API_URL') ?? null,
      },
      installDirConfigured: this.installDir !== null,
    };
  }

  async settings(): Promise<PanelDomainSettings> {
    const row = await this.repo.findOne({
      where: { id: PANEL_DOMAIN_SETTINGS_ID },
    });
    return (
      row ??
      this.repo.create({
        id: PANEL_DOMAIN_SETTINGS_ID,
        webHost: null,
        apiHost: null,
        acmeEmail: null,
        updatedAt: null,
      })
    );
  }

  async update(dto: UpdatePanelDomainDto): Promise<UpdatePanelDomainResult> {
    const webHost = dto.webHost.trim().toLowerCase();
    const apiHost = dto.apiHost.trim().toLowerCase();
    if (webHost === apiHost) {
      throw new BadRequestException('webHost and apiHost must be different');
    }
    const installDir = this.installDir;
    if (!installDir) {
      throw new BadRequestException(
        'INSTALL_DIR is not set — add INSTALL_DIR=<absolute path of the folder ' +
          'holding docker-compose.dist.yml on this host> to .env.dist and restart, ' +
          'then try again',
      );
    }

    // Checked up front (not just inside apply()) so the response can tell the
    // dashboard whether the proxy is about to be auto-provisioned, and it can
    // show the operator what to double-check (DNS, firewall) rather than
    // leaving them to guess why the new domain isn't reachable yet.
    const proxyStatus = await this.proxy.status();
    const proxyAutoProvisioned = !proxyStatus.running;

    const row = await this.settings();
    const saved = await this.repo.save(
      this.repo.merge(row, {
        webHost,
        apiHost,
        // acmeEmail is optional so re-applying just the hosts doesn't clobber
        // an ACME email set on a previous call.
        ...(dto.acmeEmail !== undefined
          ? { acmeEmail: dto.acmeEmail.trim() || null }
          : {}),
        updatedAt: new Date(),
      }),
    );

    // Detached: the compose apply below recreates this very container.
    setTimeout(() => {
      this.apply(saved, installDir).catch((err: unknown) => {
        this.logger.error(`Applying panel domain failed: ${String(err)}`);
      });
    }, 1500);

    return { settings: saved, proxyAutoProvisioned };
  }

  private async apply(
    settings: PanelDomainSettings,
    installDir: string,
  ): Promise<void> {
    const httpsPort = Number(
      this.config.get<string>('PROXY_HTTPS_PORT') ?? 443,
    );
    const acmeEmail = settings.acmeEmail;

    // The Traefik labels below are pointless without the proxy actually
    // running — bring it up automatically instead of leaving the domain
    // silently unreachable (this exact gap is what caused a real-VPS test to
    // fail: domain saved fine, container got its labels, but nothing was
    // listening on 80/443). Only when it isn't already running: a running
    // proxy is left untouched so this doesn't clobber ACME state or disrupt
    // routing for other apps every time the panel domain is saved.
    const proxyStatus = await this.proxy.status();
    if (!proxyStatus.running) {
      this.logger.log('Proxy is not running — provisioning it automatically');
      await this.proxy.provisionOn(this.docker, {
        httpPort: this.proxy.httpPort,
        httpsPort: this.proxy.httpsPort,
        acmeEmail,
        acmeStaging: this.proxy.localSettings.acmeStaging,
      });
    }

    const override = renderPanelOverride(settings.webHost!, settings.apiHost!, {
      httpsPort,
      acme: acmeEmail !== null,
    });

    const script = [
      'set -e',
      `cd ${installDir}`,
      envUpsertLine('WEB_DOMAIN', settings.webHost!),
      envUpsertLine('API_DOMAIN', settings.apiHost!),
      envUpsertLine('PROXY_ACME_EMAIL', acmeEmail ?? ''),
      envUpsertLine('WEB_ORIGIN', `https://${settings.webHost}`),
      envUpsertLine('PUBLIC_API_URL', `https://${settings.apiHost}`),
      envUpsertLine('COOKIE_SECURE', 'true'),
      // Compose only auto-includes docker-compose.override.yml when the base
      // file is named exactly docker-compose.yml — with -f docker-compose.dist.yml
      // given explicitly, the override must be listed explicitly too, or the
      // Traefik labels below are silently never applied.
      `docker compose -f docker-compose.dist.yml -f ${OVERRIDE_FILE} --env-file .env.dist up -d`,
    ].join('\n');

    await runComposeHelper(this.docker, installDir, script, [
      [OVERRIDE_FILE, override],
    ]);
  }
}
