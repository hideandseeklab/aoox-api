import { ConflictException, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Application } from '../application.entity';
import { ApplicationService } from '../application.service';
import {
  Deployment,
  DeploymentKind,
  DeploymentTrigger,
} from '../deployment.entity';
import { DeploymentRunnerService } from '../deployment-runner.service';

export interface DeploymentTriggerInfo {
  trigger: DeploymentTrigger;
  commitSha?: string | null;
  commitMessage?: string | null;
  triggeredBy?: string | null;
}

/** Queues a deployment and returns immediately; the runner does the work. */
@Injectable()
export class DeployApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
  ) {}

  async execute(
    ownerId: string,
    id: string,
    actorEmail: string,
  ): Promise<Deployment> {
    const app = await this.applications.findOwnedOrFail(id, ownerId);
    return this.queue(app, 'build', {
      trigger: 'manual',
      triggeredBy: actorEmail,
    });
  }

  /** Queues a build deployment for an already-authorized application. */
  async queue(
    app: Application,
    kind: DeploymentKind = 'build',
    info: DeploymentTriggerInfo = {
      trigger: kind === 'auto-update' ? 'auto-update' : 'manual',
    },
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
        trigger: info.trigger,
        commitSha: info.commitSha ?? null,
        commitMessage: info.commitMessage ?? null,
        triggeredBy: info.triggeredBy ?? null,
      }),
    );
    this.runner.start(deployment, app);
    return deployment;
  }
}
