import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PROXY_CERTS_DIR,
  PROXY_CERTS_VOLUME,
} from '../certificate/certs-config';
import { tarFiles } from '../application/nixpacks-builder.service';
import { Application } from '../application/application.entity';
import { dnsRouting } from '../application/cert-mode';
import { Domain } from '../application/domain.entity';
import { composeLabels, DockerService } from '../docker/docker.service';
import { APP_NETWORK, ProxyService } from '../proxy/proxy.service';
import {
  appDynamicConfig,
  appDynamicFileName,
  appPageFileName,
  MAINTENANCE_CONTAINER,
  MAINTENANCE_IMAGE,
  MAINTENANCE_SHARED_FILE,
  MAINTENANCE_VOLUME,
  sharedDynamicConfig,
  toDynamicYaml,
} from './maintenance-dynamic';
import {
  renderMaintenanceNginxConf,
  renderMaintenancePage,
} from './maintenance-page';

const HELPER_IMAGE = 'busybox:stable';
const PAGES_DIR = '/pages';

/**
 * Maintenance mode: routes an application's domains to a static 503 page
 * instead of the application. Only Traefik's routing changes; the application
 * container is never touched (see maintenance-dynamic.ts for why).
 *
 * Local host only (the flow rejects remote servers). Every write goes through
 * one queue so container and volume writes of two requests never interleave.
 */
@Injectable()
export class MaintenanceModeService {
  private readonly logger = new Logger(MaintenanceModeService.name);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectRepository(Application)
    private readonly apps: Repository<Application>,
    @InjectRepository(Domain)
    private readonly domains: Repository<Domain>,
    private readonly docker: DockerService,
    private readonly proxy: ProxyService,
  ) {}

  /**
   * Brings the routing in line with the application's state: flag on means
   * the page is in place for its domains, flag off does nothing. Call after
   * the flag changes and after any change to its domains.
   */
  refresh(appId: string): Promise<void> {
    return this.serial(async () => {
      const app = await this.apps.findOne({ where: { id: appId } });
      if (!app?.maintenanceEnabled) return;
      await this.activate(app);
    });
  }

  /** Removes this application's routers and page (the shared service stays). */
  deactivate(appId: string): Promise<void> {
    return this.serial(async () => {
      await this.removeFiles(PROXY_CERTS_VOLUME, PROXY_CERTS_DIR, [
        appDynamicFileName(appId),
      ]);
      await this.removeFiles(MAINTENANCE_VOLUME, PAGES_DIR, [
        appPageFileName(appId),
      ]);
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => undefined).then(fn);
    this.queue = run;
    return run;
  }

  private async activate(app: Application): Promise<void> {
    await this.ensurePageServer();
    await this.writeFiles(MAINTENANCE_VOLUME, PAGES_DIR, [
      ['default.html', renderMaintenancePage(null), 0o644],
      [
        appPageFileName(app.id),
        renderMaintenancePage(app.maintenanceMessage),
        0o644,
      ],
    ]);
    const domains = await this.domains.find({
      where: { applicationId: app.id },
    });
    const settings = this.proxy.localSettings;
    const routers =
      appDynamicConfig(
        app.id,
        domains.map((d) => ({
          host: d.host,
          https: d.https,
          customCert: d.certificateId !== null,
          middlewares: d.middlewares ?? [],
          dns: dnsRouting(d.host, d.certMode),
        })),
        {
          acme: settings.acmeEmail !== null,
          dns: domains.some((d) => d.certMode && d.certMode !== 'http')
            ? await this.proxy.dnsChallengeActive(this.docker)
            : false,
        },
      ) ?? {};
    await this.writeFiles(PROXY_CERTS_VOLUME, PROXY_CERTS_DIR, [
      [MAINTENANCE_SHARED_FILE, toDynamicYaml(sharedDynamicConfig()), 0o644],
      [appDynamicFileName(app.id), toDynamicYaml(routers), 0o644],
    ]);
    // Only proxies created with the file provider load these files: upgrade an
    // older running proxy once (same rule as the certificates).
    const status = await this.proxy.status();
    if (!status.running) {
      this.logger.warn(
        `Maintenance page for ${app.appName} saved; it shows once the proxy runs`,
      );
    } else if (!status.customCerts) {
      await this.proxy.upgradeToCustomCerts(this.docker, settings);
    }
    this.logger.log(`Maintenance mode on for ${app.appName}`);
  }

  /** Creates (or starts) the one shared nginx that serves every page. */
  private async ensurePageServer(): Promise<void> {
    await this.docker.engine.createVolume(MAINTENANCE_VOLUME);
    const existing = await this.docker.findContainerByName(
      MAINTENANCE_CONTAINER,
    );
    if (existing) {
      if (existing.State !== 'running') {
        await this.docker.engine.startContainer(existing.Id);
      }
      return;
    }
    await this.docker.ensureImage(MAINTENANCE_IMAGE);
    await this.docker.ensureNetwork(APP_NETWORK);
    const id = await this.docker.engine.createContainer(
      {
        Image: MAINTENANCE_IMAGE,
        Labels: {
          ...composeLabels('maintenance'),
          'aoox.component': 'maintenance',
        },
        HostConfig: {
          Binds: [`${MAINTENANCE_VOLUME}:/www/pages:ro`],
          NetworkMode: APP_NETWORK,
          RestartPolicy: { Name: 'unless-stopped' },
          ...(this.docker.logConfig
            ? { LogConfig: this.docker.logConfig }
            : {}),
        },
      },
      MAINTENANCE_CONTAINER,
    );
    // Replaces nginx's default site before the first start.
    await this.docker.engine.putArchive(
      id,
      '/etc/nginx/conf.d',
      tarFiles([['default.conf', renderMaintenanceNginxConf(), 0o644]]),
    );
    await this.docker.engine.startContainer(id);
  }

  /** Writes files into a volume through a throwaway busybox (mounts.ts pattern). */
  private async writeFiles(
    volume: string,
    path: string,
    files: Array<[name: string, content: string, mode: number]>,
  ): Promise<void> {
    await this.docker.engine.createVolume(volume);
    await this.docker.ensureImage(HELPER_IMAGE);
    const helper = await this.docker.engine.createContainer({
      Image: HELPER_IMAGE,
      Cmd: ['true'],
      Labels: composeLabels('maintenance-helper'),
      HostConfig: { Binds: [`${volume}:${path}`] },
    });
    try {
      await this.docker.engine.putArchive(helper, path, tarFiles(files));
    } finally {
      await this.docker.engine
        .removeContainer(helper, true)
        .catch(() => undefined);
    }
  }

  /** `rm -f` of known names; no shell, the names come from application uuids. */
  private async removeFiles(
    volume: string,
    path: string,
    names: string[],
  ): Promise<void> {
    await this.docker.ensureImage(HELPER_IMAGE);
    const { code, output } = await this.docker.runOnceWithOutput({
      Image: HELPER_IMAGE,
      Cmd: ['rm', '-f', ...names.map((n) => `${path}/${n}`)],
      Labels: composeLabels('maintenance-helper'),
      HostConfig: { Binds: [`${volume}:${path}`] },
    });
    if (code !== 0) {
      throw new Error(`Removing maintenance files failed: ${output}`);
    }
  }
}
