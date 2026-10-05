import { Injectable, Logger } from '@nestjs/common';
import { CertificateSyncService } from '../../certificate/certificate-sync.service';
import { IsNull, Not } from 'typeorm';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { MetricRetentionService } from '../../monitoring/metric-retention.service';
import { PreviewService } from '../preview.service';
import { SwarmDeployService } from '../swarm-deploy.service';

/** Removes the container (if any) and the row; images in the registry are kept. */
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
  ) {}

  async execute(ownerId: string, id: string): Promise<void> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    // Preview containers are not covered by the FK cascade of their rows.
    await this.previews.destroyAll(app);
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker
      .findContainerByName(containerNameFor(app))
      .catch(() => null);
    if (c) await docker.engine.removeContainer(c.Id, true);
    if (app.deployMode === 'service') {
      await this.swarmDeploy.remove(app).catch(() => undefined);
    }
    await this.retention.forget('application', app.id);
    // Domains go with the row (FK cascade): remember whether any used an
    // uploaded certificate so its files can be dropped from the proxy volume.
    const usedCertificate =
      (await this.applications.domains.count({
        where: { applicationId: app.id, certificateId: Not(IsNull()) },
      })) > 0;
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
