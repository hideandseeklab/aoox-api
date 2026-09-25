import { ConflictException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Application } from '../application.entity';
import { ApplicationService } from '../application.service';
import { Deployment, DeploymentKind } from '../deployment.entity';
import { DeploymentRunnerService } from '../deployment-runner.service';

/** Queues a deployment and returns immediately; the runner does the work. */
@Injectable()
export class DeployApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
  ) {}

  async execute(ownerId: string, id: string): Promise<Deployment> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    return this.queue(app);
  }

  /** Queues a build deployment for an already-authorized application. */
  async queue(
    app: Application,
    kind: DeploymentKind = 'build',
  ): Promise<Deployment> {
    const inFlight = await this.applications.deployments.count({
      where: {
        applicationId: app.id,
        status: In(['queued', 'building', 'pushing', 'starting']),
      },
    });
    if (inFlight > 0) {
      throw new ConflictException('A deployment is already in progress');
    }

    const deployment = await this.applications.deployments.save(
      this.applications.deployments.create({
        applicationId: app.id,
        status: 'queued',
        kind,
        logs: '',
      }),
    );
    this.runner.start(deployment, app);
    return deployment;
  }
}
