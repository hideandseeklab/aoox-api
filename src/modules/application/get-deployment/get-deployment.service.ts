import { Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationService } from '../application.service';
import { Deployment } from '../deployment.entity';

@Injectable()
export class GetDeploymentService {
  constructor(private readonly applications: ApplicationService) {}

  async execute(ownerId: string, id: string): Promise<Deployment> {
    void ownerId; // kept for call-site clarity; see ProjectService.findOwnedOrFail
    const d = await this.applications.deployments.findOne({
      where: { id }, // visibility: one team per instance (see ProjectService)
    });
    if (!d) throw new NotFoundException('Deployment not found');
    return d;
  }
}
