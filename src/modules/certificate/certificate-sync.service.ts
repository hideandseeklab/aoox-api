import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Domain } from '../application/domain.entity';
import { tarFiles } from '../application/nixpacks-builder.service';
import { composeLabels, DockerHandle } from '../docker/docker.service';
import { ProxyService, ProxySettings } from '../proxy/proxy.service';
import { RemoteDockerService } from '../server/remote-docker.service';
import { proxySettingsOf } from '../server/server.entity';
import { ServerService } from '../server/server.service';
import {
  CERTS_CONFIG_FILE,
  certFileNames,
  PROXY_CERTS_VOLUME,
  renderCertsYml,
} from './certs-config';
import { CertificateService } from './certificate.service';

const HELPER_IMAGE = 'busybox:stable';
/** Time Traefik gets to switch to the new certs.yml before old files are removed. */
const PRUNE_GRACE_SECONDS = 5;

export interface SyncResult {
  /** Certificates now present in that daemon's cert volume. */
  certificates: number;
  /** The proxy had no custom-certificate support and was recreated once. */
  proxyRecreated: boolean;
}

/**
 * Keeps the proxy's cert volume (per daemon: the aoox host, or a remote
 * server) equal to the set of certificates its applications' domains use.
 * Traefik watches the directory, so changes need no proxy restart; only a
 * proxy created before this feature is recreated once. Private keys are
 * written with mode 0600 and exist nowhere else in plaintext (the database
 * holds them encrypted).
 */
@Injectable()
export class CertificateSyncService {
  private readonly logger = new Logger(CertificateSyncService.name);
  /** One sync at a time per daemon (volume writes must not interleave). */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(Domain) private readonly domains: Repository<Domain>,
    private readonly certs: CertificateService,
    private readonly proxy: ProxyService,
    private readonly remote: RemoteDockerService,
    private readonly servers: ServerService,
  ) {}

  /** Syncs the daemon that runs `serverId` (null = the aoox host). */
  async syncServer(serverId: string | null): Promise<SyncResult> {
    const docker = await this.remote.forServer(serverId);
    const settings = serverId
      ? proxySettingsOf(await this.servers.findOrFail(serverId))
      : this.proxy.localSettings;
    return this.sync(docker, settings, serverId);
  }

  /** Every daemon that has a domain using this certificate. */
  async syncForCertificate(certificateId: string): Promise<SyncResult[]> {
    const rows = await this.domains
      .createQueryBuilder('d')
      .innerJoin('d.application', 'a')
      .select('DISTINCT a.server_id', 'serverId')
      .where('d.certificate_id = :certificateId', { certificateId })
      .getRawMany<{ serverId: string | null }>();
    const out: SyncResult[] = [];
    for (const r of rows) out.push(await this.syncServer(r.serverId));
    return out;
  }

  sync(
    docker: DockerHandle,
    settings: ProxySettings,
    serverId: string | null,
  ): Promise<SyncResult> {
    const queueKey = serverId ?? 'local';
    const previous = this.queues.get(queueKey) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.doSync(docker, settings, serverId));
    this.queues.set(queueKey, run);
    return run;
  }

  /** Ids of the certificates used by applications on that daemon. */
  private async idsFor(serverId: string | null): Promise<string[]> {
    const qb = this.domains
      .createQueryBuilder('d')
      .innerJoin('d.application', 'a')
      .select('DISTINCT d.certificate_id', 'id')
      .where('d.certificate_id IS NOT NULL');
    if (serverId) qb.andWhere('a.server_id = :serverId', { serverId });
    else qb.andWhere('a.server_id IS NULL');
    return (await qb.getRawMany<{ id: string }>()).map((r) => r.id);
  }

  private async doSync(
    docker: DockerHandle,
    settings: ProxySettings,
    serverId: string | null,
  ): Promise<SyncResult> {
    const ids = await this.idsFor(serverId);
    const rows = await this.certs.withKeys(ids);

    // Files first, certs.yml last: Traefik reloads on every change and must
    // never see a config that points at a file that is not there yet.
    const files: Array<[string, string, number]> = [];
    for (const c of rows) {
      const n = certFileNames(c.id, c.fingerprint);
      files.push([n.cert, c.certificatePem, 0o644], [n.key, c.keyPem, 0o600]);
    }
    files.push([
      CERTS_CONFIG_FILE,
      renderCertsYml(
        rows.map((c) => ({ id: c.id, fingerprint: c.fingerprint })),
      ),
      0o644,
    ]);

    await docker.engine.createVolume(PROXY_CERTS_VOLUME);
    await docker.ensureImage(HELPER_IMAGE);
    const helper = await docker.engine.createContainer({
      Image: HELPER_IMAGE,
      Cmd: ['true'],
      Labels: composeLabels('cert-helper'),
      HostConfig: { Binds: [`${PROXY_CERTS_VOLUME}:/certs`] },
    });
    try {
      await docker.engine.putArchive(helper, '/certs', tarFiles(files));
    } finally {
      await docker.engine.removeContainer(helper, true).catch(() => undefined);
    }
    await this.pruneStale(
      docker,
      files.map(([name]) => name),
    );

    let proxyRecreated = false;
    if (rows.length > 0) {
      proxyRecreated = await this.proxy.upgradeToCustomCerts(docker, settings);
    }
    this.logger.log(
      `Custom certificates synced on ${docker.engine.target}: ${rows.length}${proxyRecreated ? ' (proxy recreated once to load them)' : ''}`,
    );
    return { certificates: rows.length, proxyRecreated };
  }

  /**
   * Removes certificate/key files that no domain uses any more, so a key
   * does not outlive its assignment. The keep list goes through the
   * environment (it is built from row ids, but nothing is ever interpolated
   * into the script). Best effort: a failure only leaves an unused file.
   */
  private async pruneStale(
    docker: DockerHandle,
    keep: readonly string[],
  ): Promise<void> {
    try {
      const { code, output } = await docker.runOnceWithOutput({
        Image: HELPER_IMAGE,
        Cmd: [
          'sh',
          '-c',
          // Old files go only after a grace period: Traefik reloads on a
          // throttle, and must read the new certs.yml before the files the
          // previous one points at disappear.
          'cd /certs && stale=""; for f in *.crt *.key; do [ -e "$f" ] || continue; case " $KEEP " in *" $f "*) ;; *) stale="$stale $f";; esac; done; [ -n "$stale" ] || exit 0; sleep "$GRACE"; for f in $stale; do rm -f -- "$f"; done',
        ],
        Env: [`KEEP=${keep.join(' ')}`, `GRACE=${PRUNE_GRACE_SECONDS}`],
        Labels: composeLabels('cert-helper'),
        HostConfig: { Binds: [`${PROXY_CERTS_VOLUME}:/certs`] },
      });
      if (code !== 0) {
        this.logger.warn(`Pruning unused certificate files failed: ${output}`);
      }
    } catch (err) {
      this.logger.warn(
        `Pruning unused certificate files failed: ${String(err)}`,
      );
    }
  }
}
