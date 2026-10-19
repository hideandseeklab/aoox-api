import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { BackupPurgeService } from '../../backup-purge/backup-purge.service';
import { CertificateSyncService } from '../../certificate/certificate-sync.service';
import { IsNull, Not } from 'typeorm';
import { DockerEngineError } from '../../docker/docker-engine.client';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { Application } from '../application.entity';
import { ApplicationService, containerNameFor } from '../application.service';
import { filesVolumeFor, volumeNameFor } from '../mounts';
import { MetricRetentionService } from '../../monitoring/metric-retention.service';
import { MaintenanceModeService } from '../../maintenance-mode/maintenance-mode.service';
import { DomainDnsService } from '../domain-dns.service';
import { PreviewService } from '../preview.service';
import { SwarmDeployService } from '../swarm-deploy.service';

/** A resource that is already gone is what a delete wants; anything else is a real failure. */
function ignoreMissing(err: unknown): void {
  if (err instanceof DockerEngineError && err.status === 404) return;
  throw err;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Removes the container (if any) and the row; images in the registry are
 * kept, and so are the volumes unless `purge` is set. Docker problems that
 * leave a container behind (daemon or remote server unreachable) are
 * reported and the row is kept, so the delete can be retried: a row without
 * its container would leave the app reachable through its domain.
 */
@Injectable()
export class DeleteApplicationService {
  private readonly logger = new Logger(DeleteApplicationService.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly retention: MetricRetentionService,
    private readonly previews: PreviewService,
    private readonly certSync: CertificateSyncService,
    private readonly maintenance: MaintenanceModeService,
    private readonly domainDns: DomainDnsService,
    private readonly backupPurge: BackupPurgeService,
  ) {}

  async execute(ownerId: string, id: string): Promise<void> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    await this.destroy(app);
  }

  /** The cleanup without the access check; the project delete calls this per application. */
  async destroy(
    app: Application,
    options: { purge?: boolean } = {},
  ): Promise<void> {
    // Preview containers are not covered by the FK cascade of their rows.
    await this.previews.destroyAll(app);
    const name = containerNameFor(app);
    let docker: Awaited<ReturnType<RemoteDockerService['forServer']>>;
    try {
      docker = await this.remote.forServer(app.serverId);
      // `-next` is the blue/green candidate of an interrupted deploy; it carries
      // the same Traefik labels, so it would keep serving the domain too.
      for (const n of [name, `${name}-next`]) {
        const c = await docker.findContainerByName(n);
        if (c) {
          await docker.engine.removeContainer(c.Id, true).catch(ignoreMissing);
        }
      }
      if (app.deployMode === 'service') {
        await this.swarmDeploy.remove(app).catch(ignoreMissing);
      }
    } catch (err) {
      throw new BadGatewayException(
        `Could not remove the container of "${app.name}": ${describe(err)}. The application was kept; try again once the Docker daemon is reachable.`,
      );
    }
    if (options.purge) {
      const mounts = await this.applications.mounts.find({
        where: { applicationId: app.id },
      });
      const volumes = [
        ...mounts
          .filter((m) => m.type === 'volume')
          .map((m) => volumeNameFor(app, m)),
        filesVolumeFor(app),
      ];
      for (const v of volumes) {
        try {
          await docker.engine.removeVolume(v).catch(ignoreMissing);
        } catch (err) {
          throw new BadGatewayException(
            `Could not remove volume ${v} of "${app.name}": ${describe(err)}`,
          );
        }
      }
    }
    // Volume backup files (and their S3 copies) are only reachable through the
    // rows, which go with the application: remove them while the rows exist.
    if (options.purge) {
      await this.backupPurge.purgeApplication(app.id, app.serverId);
    }
    // Routers and the page file would otherwise outlive the application.
    await this.maintenance
      .deactivate(app.id)
      .catch((err) =>
        this.logger.warn(`Maintenance cleanup failed: ${String(err)}`),
      );
    await this.retention.forget('application', app.id);
    // Domains go with the row (FK cascade): remember whether any used an
    // uploaded certificate so its files can be dropped from the proxy volume.
    const usedCertificate =
      (await this.applications.domains.count({
        where: { applicationId: app.id, certificateId: Not(IsNull()) },
      })) > 0;
    // DNS records aoox created for the domains (best effort, never blocks the delete).
    const domains = await this.applications.domains.find({
      where: { applicationId: app.id },
    });
    for (const d of domains) {
      await this.domainDns.cleanup(d);
    }
    await this.applications.repo.remove(app);
    if (usedCertificate) {
      await this.certSync
        .syncServer(app.serverId)
        .catch((err) =>
          this.logger.warn(`Certificate cleanup failed: ${String(err)}`),
        );
    }
  }
}
