import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PROXY_CERTS_DIR,
  PROXY_CERTS_VOLUME,
} from '../certificate/certs-config';
import {
  composeLabels,
  DockerHandle,
  DockerService,
} from '../docker/docker.service';

/**
 * Traefik reverse proxy managed by aoox: routes domains to application
 * containers via Docker labels. One per install.
 * Config keys follow https://doc.traefik.io/traefik/ (v3).
 */
export const PROXY_CONTAINER = 'aoox-proxy';
export const PROXY_IMAGE = 'traefik:v3';
export const PROXY_ACME_VOLUME = 'aoox_proxy_acme';
/** Bridge network shared by the proxy and every application container. */
export const APP_NETWORK = 'aoox';
/** Attachable overlay for swarm services (created by SwarmService.init). */
export const SWARM_NETWORK = 'aoox-swarm';
export const CERT_RESOLVER = 'le';

/** A host routed to a container. `customCert`: serve an uploaded certificate, not ACME. */
export interface RoutedDomain {
  host: string;
  https: boolean;
  customCert?: boolean;
}

export interface ProxyStatus {
  installed: boolean;
  running: boolean;
  state: string | null;
  containerId: string | null;
  httpPort: number;
  httpsPort: number;
  acmeEmail: string | null;
  /**
   * Whether this proxy container can serve uploaded certificates (file
   * provider + cert volume). False for proxies created by an older aoox; they
   * are recreated once, automatically, when the first custom certificate is
   * assigned. Meaningless (false) while not installed.
   */
  customCerts: boolean;
}

/** Ports and ACME for one proxy: env for the aoox host, a row for remote servers. */
export interface ProxySettings {
  httpPort: number;
  httpsPort: number;
  acmeEmail: string | null;
  acmeStaging: boolean;
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly docker: DockerService,
    private readonly config: ConfigService,
  ) {}

  get httpPort(): number {
    return Number(this.config.get<string>('PROXY_HTTP_PORT') ?? 80);
  }

  get httpsPort(): number {
    return Number(this.config.get<string>('PROXY_HTTPS_PORT') ?? 443);
  }

  get acmeEmail(): string | null {
    return this.config.get<string>('PROXY_ACME_EMAIL')?.trim() || null;
  }

  /** Settings of the proxy on the aoox host (env). */
  get localSettings(): ProxySettings {
    return {
      httpPort: this.httpPort,
      httpsPort: this.httpsPort,
      acmeEmail: this.acmeEmail,
      acmeStaging: this.config.get<string>('PROXY_ACME_STAGING') === 'true',
    };
  }

  status(): Promise<ProxyStatus> {
    return this.statusOn(this.docker, this.localSettings);
  }

  provision(): Promise<void> {
    return this.provisionOn(this.docker, this.localSettings);
  }

  remove(purge: boolean): Promise<void> {
    return this.removeOn(this.docker, purge);
  }

  async statusOn(
    docker: DockerHandle,
    settings: ProxySettings,
  ): Promise<ProxyStatus> {
    const c = await docker.findContainerByName(PROXY_CONTAINER);
    const inspect = c ? await docker.engine.inspectContainer(c.Id) : null;
    return {
      installed: !!c,
      running: c?.State === 'running',
      state: c?.State ?? null,
      containerId: c?.Id ?? null,
      httpPort: settings.httpPort,
      httpsPort: settings.httpsPort,
      acmeEmail: settings.acmeEmail,
      customCerts: inspect ? ProxyService.supportsCustomCerts(inspect) : false,
    };
  }

  /** Pure: does this proxy container have the file provider and the cert volume? */
  static supportsCustomCerts(inspect: {
    Config: { Cmd?: string[] | null };
    HostConfig?: { Binds?: string[] | null };
  }): boolean {
    const cmd = inspect.Config.Cmd ?? [];
    const binds = inspect.HostConfig?.Binds ?? [];
    return (
      cmd.includes(`--providers.file.directory=${PROXY_CERTS_DIR}`) &&
      binds.includes(`${PROXY_CERTS_VOLUME}:${PROXY_CERTS_DIR}`)
    );
  }

  /**
   * Pure: the settings a running proxy container was created with, read back
   * from its command line and port bindings. Used to recreate it faithfully
   * (the panel-domain flow can have provisioned it with an ACME email that
   * differs from env, so env is not a safe source for a recreate).
   */
  static settingsOf(
    inspect: {
      Config: { Cmd?: string[] | null };
      HostConfig?: {
        PortBindings?: Record<string, { HostPort: string }[] | null>;
      };
    },
    fallback: ProxySettings,
  ): ProxySettings {
    const cmd = inspect.Config.Cmd ?? [];
    const prefix = `--certificatesresolvers.${CERT_RESOLVER}.acme.`;
    const email = cmd.find((c) => c.startsWith(`${prefix}email=`));
    const caserver = cmd.find((c) => c.startsWith(`${prefix}caserver=`));
    const port = (p: string, dflt: number) => {
      const n = Number(inspect.HostConfig?.PortBindings?.[p]?.[0]?.HostPort);
      return Number.isInteger(n) && n > 0 ? n : dflt;
    };
    return {
      httpPort: port('80/tcp', fallback.httpPort),
      httpsPort: port('443/tcp', fallback.httpsPort),
      acmeEmail: email ? email.slice(`${prefix}email=`.length) : null,
      acmeStaging: !!caserver && caserver.includes('staging'),
    };
  }

  /**
   * A running proxy created before custom certificates existed has neither
   * the file provider nor the cert volume: recreate it once, with the settings
   * it already runs with (ports, ACME email/staging) and the same ACME
   * volume, so issued certificates and other routes are untouched (a few
   * seconds of downtime). Returns true when it was recreated.
   */
  async upgradeToCustomCerts(
    docker: DockerHandle,
    fallback: ProxySettings,
  ): Promise<boolean> {
    const c = await docker.findContainerByName(PROXY_CONTAINER);
    if (!c || c.State !== 'running') return false;
    const inspect = await docker.engine.inspectContainer(c.Id);
    if (!inspect || ProxyService.supportsCustomCerts(inspect)) return false;
    await this.provisionOn(docker, ProxyService.settingsOf(inspect, fallback));
    this.logger.log(
      `Proxy on ${docker.engine.target} recreated to support custom certificates`,
    );
    return true;
  }

  /** Creates the network + acme volume and starts Traefik on `docker` (local host or a remote server). */
  async provisionOn(
    docker: DockerHandle,
    settings: ProxySettings,
  ): Promise<void> {
    await docker.ensureImage(PROXY_IMAGE);
    await docker.ensureNetwork(APP_NETWORK);
    await docker.engine.createVolume(PROXY_ACME_VOLUME);
    // Uploaded certificates (written by CertificateSyncService); persists
    // across proxy recreation like the ACME state.
    await docker.engine.createVolume(PROXY_CERTS_VOLUME);

    // On a swarm manager Traefik also reads service labels (apps in
    // deployMode 'service'); v3 has it as a separate provider.
    const info = await docker.engine.systemInfo();
    const swarm =
      info.Swarm?.LocalNodeState === 'active' && !!info.Swarm.ControlAvailable;
    const cmd = [
      '--providers.docker=true',
      '--providers.docker.exposedbydefault=false',
      `--providers.docker.network=${APP_NETWORK}`,
      ...(swarm
        ? [
            '--providers.swarm=true',
            '--providers.swarm.exposedbydefault=false',
            `--providers.swarm.network=${SWARM_NETWORK}`,
            // The swarm provider polls (no events): keep retired tasks short-lived in the router.
            '--providers.swarm.refreshSeconds=3',
          ]
        : []),
      // Custom certificates: Traefik reloads this directory on change, so
      // assigning/replacing one never recreates the proxy.
      `--providers.file.directory=${PROXY_CERTS_DIR}`,
      '--providers.file.watch=true',
      `--entrypoints.web.address=:80`,
      `--entrypoints.websecure.address=:443`,
      '--log.level=INFO',
    ];
    const email = settings.acmeEmail;
    if (email) {
      cmd.push(
        `--certificatesresolvers.${CERT_RESOLVER}.acme.email=${email}`,
        `--certificatesresolvers.${CERT_RESOLVER}.acme.storage=/letsencrypt/acme.json`,
        `--certificatesresolvers.${CERT_RESOLVER}.acme.httpchallenge.entrypoint=web`,
      );
      if (settings.acmeStaging) {
        cmd.push(
          `--certificatesresolvers.${CERT_RESOLVER}.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory`,
        );
      }
    }

    const existing = await docker.findContainerByName(PROXY_CONTAINER);
    if (existing) await docker.engine.removeContainer(existing.Id, true);
    const id = await docker.engine.createContainer(
      {
        Image: PROXY_IMAGE,
        Cmd: cmd,
        Labels: {
          'aoox.component': 'proxy',
          ...composeLabels('proxy'),
        },
        ExposedPorts: { '80/tcp': {}, '443/tcp': {} },
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          LogConfig: this.docker.logConfig,
          NetworkMode: APP_NETWORK,
          PortBindings: {
            '80/tcp': [{ HostPort: String(settings.httpPort) }],
            '443/tcp': [{ HostPort: String(settings.httpsPort) }],
          },
          Binds: [
            `${docker.hostDockerSocket}:/var/run/docker.sock:ro`,
            `${PROXY_ACME_VOLUME}:/letsencrypt`,
            `${PROXY_CERTS_VOLUME}:${PROXY_CERTS_DIR}`,
          ],
        },
      },
      PROXY_CONTAINER,
    );
    if (swarm) await docker.engine.connectNetwork(SWARM_NETWORK, id);
    await docker.engine.startContainer(id);
    this.logger.log(
      `Proxy started on ${docker.engine.target} :${settings.httpPort}/:${settings.httpsPort} (acme: ${email ? 'on' : 'off'}, swarm: ${swarm ? 'on' : 'off'})`,
    );
  }

  async removeOn(docker: DockerHandle, purge: boolean): Promise<void> {
    const c = await docker.findContainerByName(PROXY_CONTAINER);
    if (c) await docker.engine.removeContainer(c.Id, true);
    if (purge) {
      await docker.engine
        .removeVolume(PROXY_ACME_VOLUME)
        .catch(() => undefined);
    }
  }

  /** Labels for an application container using this install's ports/ACME. */
  labelsFor(
    routerName: string,
    port: number,
    domains: RoutedDomain[],
    settings: ProxySettings = this.localSettings,
  ): Record<string, string> {
    return ProxyService.buildLabels(routerName, port, domains, {
      httpsPort: settings.httpsPort,
      acme: settings.acmeEmail !== null,
    });
  }

  /**
   * Traefik labels for a container. `routerName` must be unique per app.
   * Routers: `<name>` (web, plain-http hosts), `<name>-secure` (websecure +
   * ACME, https hosts) and — only when a cert resolver exists, so we never
   * redirect onto Traefik's self-signed default — `<name>-redirect` (web,
   * https hosts → 301 to https). Without ACME, https hosts stay reachable
   * on plain http like before. https hosts with an uploaded certificate
   * (`customCert`) get `<name>-secure-custom` (websecure, `tls=true`, no
   * resolver) and are always redirected from http, ACME or not.
   */
  static buildLabels(
    routerName: string,
    port: number,
    domains: RoutedDomain[],
    opts: { httpsPort: number; acme: boolean },
  ): Record<string, string> {
    if (domains.length === 0) return {};
    const rule = (hosts: string[]) =>
      hosts.map((h) => `Host(\`${h}\`)`).join(' || ');
    // https hosts with an uploaded certificate never go through ACME; the
    // rest keep the previous behaviour exactly.
    const custom = domains
      .filter((d) => d.https && d.customCert)
      .map((d) => d.host);
    const secure = domains
      .filter((d) => d.https && !d.customCert)
      .map((d) => d.host);
    // Custom-certificate hosts always redirect (they are https for certain,
    // the certificate is ours); ACME hosts only once a resolver exists.
    const redirectHosts = [...(opts.acme ? secure : []), ...custom];
    const redirect = redirectHosts.length > 0;
    // Hosts that must still answer on plain http.
    const plain = domains
      .map((d) => d.host)
      .filter((h) => !redirectHosts.includes(h));

    const labels: Record<string, string> = {
      'traefik.enable': 'true',
      [`traefik.http.services.${routerName}.loadbalancer.server.port`]:
        String(port),
    };
    if (plain.length > 0) {
      labels[`traefik.http.routers.${routerName}.rule`] = rule(plain);
      labels[`traefik.http.routers.${routerName}.entrypoints`] = 'web';
      labels[`traefik.http.routers.${routerName}.service`] = routerName;
    }
    if (redirect) {
      const name = `${routerName}-redirect`;
      const mw = `${routerName}-https`;
      labels[`traefik.http.routers.${name}.rule`] = rule(redirectHosts);
      labels[`traefik.http.routers.${name}.entrypoints`] = 'web';
      labels[`traefik.http.routers.${name}.service`] = routerName;
      labels[`traefik.http.routers.${name}.middlewares`] = `${mw}@docker`;
      labels[`traefik.http.middlewares.${mw}.redirectscheme.scheme`] = 'https';
      labels[`traefik.http.middlewares.${mw}.redirectscheme.permanent`] =
        'true';
      // Traefik omits :443 itself, so this is only visible on custom ports.
      labels[`traefik.http.middlewares.${mw}.redirectscheme.port`] = String(
        opts.httpsPort,
      );
    }
    if (secure.length > 0) {
      const name = `${routerName}-secure`;
      labels[`traefik.http.routers.${name}.rule`] = rule(secure);
      labels[`traefik.http.routers.${name}.entrypoints`] = 'websecure';
      labels[`traefik.http.routers.${name}.service`] = routerName;
      labels[`traefik.http.routers.${name}.tls`] = 'true';
      labels[`traefik.http.routers.${name}.tls.certresolver`] = CERT_RESOLVER;
    }
    if (custom.length > 0) {
      // `tls=true` and no resolver: Traefik picks the uploaded certificate
      // from the file provider by SNI; nothing is ever requested from ACME.
      const name = `${routerName}-secure-custom`;
      labels[`traefik.http.routers.${name}.rule`] = rule(custom);
      labels[`traefik.http.routers.${name}.entrypoints`] = 'websecure';
      labels[`traefik.http.routers.${name}.service`] = routerName;
      labels[`traefik.http.routers.${name}.tls`] = 'true';
    }
    return labels;
  }
}
