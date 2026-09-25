import { ConflictException, Injectable } from '@nestjs/common';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { Domain } from '../domain.entity';
import { AddDomainDto } from './add-domain.dto';

@Injectable()
export class AddDomainService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
    dto: AddDomainDto,
  ): Promise<Domain> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    const host = dto.host.trim().toLowerCase();
    if (await this.applications.domains.findOne({ where: { host } })) {
      throw new ConflictException(
        `${host} is already used by another application`,
      );
    }
    const domain = await this.applications.domains.save(
      this.applications.domains.create({
        applicationId: app.id,
        host,
        https: dto.https ?? false,
      }),
    );
    // Labels live on the container, so apply by recreating it (no rebuild).
    await this.runner.applyRuntimeConfig(app);
    return domain;
  }
}
