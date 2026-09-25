import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { ApplicationService } from '../application.service';
import { Deployment } from '../deployment.entity';
import { DeploymentRunnerService } from '../deployment-runner.service';

/** Queues a deployment that reuses the image of an earlier successful one. */
@Injectable()
export class RollbackApplicationService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
    targetId: string,
  ): Promise<Deployment> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    const target = await this.applications.deployments.findOne({
      where: { id: targetId, applicationId: app.id },
    });
    if (!target) throw new NotFoundException('Deployment not found');
    if (target.status !== 'success' || !target.imageRef) {
      throw new BadRequestException(
        'Only successful deployments can be rolled back to',
      );
    }

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
        kind: 'rollback',
        rolledBackFromId: target.id,
        imageRef: target.imageRef,
        status: 'queued',
        logs: '',
      }),
    );
    this.runner.start(deployment, app);
    return deployment;
  }
}
