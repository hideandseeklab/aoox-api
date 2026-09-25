import { Injectable } from '@nestjs/common';
import { ApplicationService } from '../application.service';
import { Deployment } from '../deployment.entity';

/** Newest first, without the (potentially large) log text. */
@Injectable()
export class ListDeploymentsService {
  constructor(private readonly applications: ApplicationService) {}

  async execute(
    ownerId: string,
    applicationId: string,
  ): Promise<Omit<Deployment, 'logs' | 'application'>[]> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    return this.applications.deployments.find({
      where: { applicationId: app.id },
      select: {
        id: true,
        applicationId: true,
        status: true,
        kind: true,
        rolledBackFromId: true,
        imageRef: true,
        errorMessage: true,
        createdAt: true,
        finishedAt: true,
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }
}
