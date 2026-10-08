import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { tarFiles } from '../application/nixpacks-builder.service';
import { PROXY_CERTS_VOLUME } from '../certificate/certs-config';
import { composeLabels, DockerHandle } from '../docker/docker.service';
import {
  PROXY_CONTAINER,
  ProxyService,
  ProxySettings,
} from '../proxy/proxy.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { proxySettingsOf } from '../server/server.entity';
import { ServerService } from '../server/server.service';
import { ProxyConfigFile } from './proxy-config.entity';
import { userFileName } from './proxy-config-schema';
import { errorsAbout } from './traefik-log';

const HELPER_IMAGE = 'busybox:stable';
/** Time Traefik gets (file watcher + provider throttle) to load or reject a file. */
export const VERIFY_WAIT_MS = 4000;

export interface SyncReport {
  /** Files now present in that proxy's dynamic directory. */
  files: number;
  proxy: 'running' | 'not-running' | 'not-installed';
  /** The proxy had no file-provider support and was recreated once. */
  proxyRecreated: boolean;
  /** Traefik's own errors about the verified file, empty when it loaded cleanly. */
  errors: string[];
  /** True when the log was read after writing and showed no error for the file. */
  verified: boolean;
  /** Why a file written to disk may not be live (proxy stopped, not installed). */
  warning: string | null;
  /** Set when the proxy was recreated to load the files: tell the operator. */
  notice: string | null;
}

/** What the editor needs to know before the first write to a proxy. */
export interface ProxyConfigState {
  proxy: 'running' | 'not-running' | 'not-installed';
  /**
   * Whether the proxy container loads the dynamic directory. A proxy created
   * by an older aoox does not and is recreated once on the first write.
   */
  fileProvider: boolean;
  /** Writing an enabled file now would recreate the proxy (a few seconds without service). */
  needsRecreate: boolean;
}

export interface VerifyTarget {
  /** Config name (slug) of the file just written. */
  name: string;
  /** Declared elements (`mw@file` form) to look for in Traefik's error lines. */
  refs: string[];
}

/**
 * Keeps each proxy's dynamic directory (the `aoox_proxy_certs` volume, on the
 * aoox host or a remote server) equal to the enabled operator files in the
 * database. It only ever writes `user-*.yml` and only sweeps `user-*.yml`:
 * certs.yml, *.crt and *.key belong to CertificateSyncService, which in turn
 * never touches `user-` names. Traefik watches the directory, so no restart.
 */
@Injectable()
export class ProxyConfigSyncService {
  private readonly logger = new Logger(ProxyConfigSyncService.name);
  /** Wait before reading the proxy log; a field so tests can shorten it. */
  verifyWaitMs = VERIFY_WAIT_MS;
  /** One sync at a time per daemon (volume writes must not interleave). */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(ProxyConfigFile)
    private readonly files: Repository<ProxyConfigFile>,
    private readonly proxy: ProxyService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
  ) {}

  /** Pure read of the proxy on that daemon (no writes). */
  async state(serverId: string | null): Promise<ProxyConfigState> {
    const docker = await this.remote.forServer(serverId);
    const settings: ProxySettings = serverId
      ? proxySettingsOf(await this.servers.findOrFail(serverId))
      : this.proxy.localSettings;
    const status = await this.proxy.statusOn(docker, settings);
    const proxy = !status.installed
      ? 'not-installed'
      : status.running
        ? 'running'
        : 'not-running';
    return {
      proxy,
      fileProvider: status.customCerts,
      needsRecreate: proxy === 'running' && !status.customCerts,
    };
  }

  sync(serverId: string | null, verify?: VerifyTarget): Promise<SyncReport> {
    const key = serverId ?? 'local';
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.doSync(serverId, verify));
    this.queues.set(key, run);
    return run;
  }

  private async doSync(
    serverId: string | null,
    verify?: VerifyTarget,
  ): Promise<SyncReport> {
    const docker = await this.remote.forServer(serverId);
    const settings: ProxySettings = serverId
      ? proxySettingsOf(await this.servers.findOrFail(serverId))
      : this.proxy.localSettings;
    const rows = await this.files.find({
      where: { serverId: serverId ?? IsNull(), enabled: true },
      order: { name: 'ASC' },
    });

    await docker.engine.createVolume(PROXY_CERTS_VOLUME);
    await docker.ensureImage(HELPER_IMAGE);
    const startedAt = Math.floor(Date.now() / 1000) - 1;
    if (rows.length > 0) await this.write(docker, rows);
    await this.prune(
      docker,
      rows.map((r) => userFileName(r.name)),
    );

    const status = await this.proxy.statusOn(docker, settings);
    const report: SyncReport = {
      files: rows.length,
      proxy: !status.installed
        ? 'not-installed'
        : status.running
          ? 'running'
          : 'not-running',
      proxyRecreated: false,
      errors: [],
      verified: false,
      warning: null,
      notice: null,
    };
    if (report.proxy === 'running' && rows.length > 0 && !status.customCerts) {
      report.proxyRecreated = await this.proxy.upgradeToCustomCerts(
        docker,
        settings,
      );
      if (report.proxyRecreated) {
        report.notice =
          'The proxy was recreated once to load dynamic configuration (a few seconds without service); certificates and other routes are unchanged';
      }
    }
    if (report.proxy !== 'running') {
      report.warning =
        report.proxy === 'not-installed'
          ? 'The proxy is not installed on this server yet; the files are saved and will load when it is provisioned'
          : 'The proxy is not running; the files are saved and will load when it starts, but Traefik could not check them';
    } else if (verify) {
      await new Promise((r) => setTimeout(r, this.verifyWaitMs));
      const container = await docker.findContainerByName(PROXY_CONTAINER);
      if (container) {
        const log = await docker.engine
          .containerLogsSince(container.Id, startedAt)
          .catch(() => '');
        report.errors = errorsAbout(
          log,
          userFileName(verify.name),
          verify.refs,
        );
        report.verified = report.errors.length === 0;
      }
    }
    this.logger.log(
      `Proxy config synced on ${docker.engine.target}: ${rows.length} file(s)${report.errors.length ? `, ${report.errors.length} error line(s)` : ''}`,
    );
    return report;
  }

  private async write(
    docker: DockerHandle,
    rows: ProxyConfigFile[],
  ): Promise<void> {
    const helper = await docker.engine.createContainer({
      Image: HELPER_IMAGE,
      Cmd: ['true'],
      Labels: composeLabels('proxy-config-helper'),
      HostConfig: { Binds: [`${PROXY_CERTS_VOLUME}:/dynamic`] },
    });
    try {
      await docker.engine.putArchive(
        helper,
        '/dynamic',
        tarFiles(
          rows.map((r): [string, string, number] => [
            userFileName(r.name),
            r.content,
            0o644,
          ]),
        ),
      );
    } finally {
      await docker.engine.removeContainer(helper, true).catch(() => undefined);
    }
  }

  /**
   * Removes `user-*.yml` files that are not in the keep list (deleted or
   * disabled). No grace period, unlike the certificate sweep: files reference
   * each other by `name@file`, never by path, so there is no ordering hazard.
   * Only the `user-` prefix is ever matched. Best effort.
   */
  private async prune(
    docker: DockerHandle,
    keep: readonly string[],
  ): Promise<void> {
    try {
      const { code, output } = await docker.runOnceWithOutput({
        Image: HELPER_IMAGE,
        Cmd: [
          'sh',
          '-c',
          'cd /dynamic && for f in user-*.yml; do [ -e "$f" ] || continue; case " $KEEP " in *" $f "*) ;; *) rm -f -- "$f";; esac; done',
        ],
        Env: [`KEEP=${keep.join(' ')}`],
        Labels: composeLabels('proxy-config-helper'),
        HostConfig: { Binds: [`${PROXY_CERTS_VOLUME}:/dynamic`] },
      });
      if (code !== 0) {
        this.logger.warn(`Pruning proxy config files failed: ${output}`);
      }
    } catch (err) {
      this.logger.warn(`Pruning proxy config files failed: ${String(err)}`);
    }
  }
}
