import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { tarFiles } from '../application/nixpacks-builder.service';
import { DockerService } from '../docker/docker.service';
import {
  PANEL_DOMAIN_SETTINGS_ID,
  PanelDomainSettings,
} from './panel-domain-settings.entity';
import { renderPanelOverride } from './panel-domain.util';
import { UpdatePanelDomainDto } from './update-panel-domain.dto';

const COMPOSE_CLI_IMAGE = 'docker:29-cli';
const OVERRIDE_FILE = 'docker-compose.override.yml';

export interface PanelDomainStatus {
  settings: PanelDomainSettings;
  applied: { webOrigin: string | null; publicApiUrl: string | null };
  installDirConfigured: boolean;
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

  async update(dto: UpdatePanelDomainDto): Promise<PanelDomainSettings> {
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

    return saved;
  }

  private async apply(
    settings: PanelDomainSettings,
    installDir: string,
  ): Promise<void> {
    const httpsPort = Number(
      this.config.get<string>('PROXY_HTTPS_PORT') ?? 443,
    );
    const acmeEmail = settings.acmeEmail;
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
      'docker compose -f docker-compose.dist.yml --env-file .env.dist up -d',
    ].join('\n');

    await this.docker.ensureImage(COMPOSE_CLI_IMAGE);
    const id = await this.docker.engine.createContainer({
      Image: COMPOSE_CLI_IMAGE,
      Entrypoint: ['sh', '-c', script],
      Labels: { 'aoox.component': 'build' },
      HostConfig: {
        Binds: [
          `${this.docker.hostDockerSocket}:/var/run/docker.sock`,
          `${installDir}:${installDir}`,
        ],
        NetworkMode: 'bridge',
      },
    });
    try {
      await this.docker.engine.putArchive(
        id,
        installDir,
        tarFiles([[OVERRIDE_FILE, override]]),
      );
      await this.docker.engine.startContainer(id);
      await this.docker.engine.waitContainer(id);
    } finally {
      await this.docker.engine.removeContainer(id, true).catch(() => undefined);
    }
  }
}

/** `sh` line that sets KEY=value in .env.dist, replacing any existing line for KEY. */
function envUpsertLine(key: string, value: string): string {
  const escaped = value.replace(/[\\&/]/g, '\\$&');
  return (
    `grep -q '^${key}=' .env.dist ` +
    `&& sed -i "s/^${key}=.*/${key}=${escaped}/" .env.dist ` +
    `|| echo '${key}=${value}' >> .env.dist`
  );
}
