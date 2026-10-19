import { normalizeBind } from '../../docker/host-port-bind';
import { BadRequestException, Injectable } from '@nestjs/common';
import { OwnerVariableSetsService } from '../../application/variable-set-links/variable-set-links.service';
import { GitCredentialService } from '../../git-credential/git-credential.service';
import { ComposeAppFieldsDto } from '../compose-app.dto';
import { ComposeApp } from '../compose-app.entity';
import { ComposeService } from '../compose.service';
import { asTarget } from '../create-compose-app/create-compose-app.service';

/** Settings only; they take effect on the next deploy. */
@Injectable()
export class UpdateComposeAppService {
  constructor(
    private readonly compose: ComposeService,
    private readonly credentials: GitCredentialService,
    private readonly variableSets: OwnerVariableSetsService,
  ) {}

  async execute(
    ownerId: string,
    id: string,
    dto: ComposeAppFieldsDto,
  ): Promise<ComposeApp> {
    const app = await this.compose.findOwnedOrFail(id, ownerId);
    if (dto.name !== undefined) app.name = dto.name.trim();
    if (dto.gitUrl !== undefined) app.gitUrl = dto.gitUrl.trim();
    if (dto.gitBranch !== undefined) {
      app.gitBranch = dto.gitBranch.trim() || 'main';
    }
    if (dto.composePath !== undefined) {
      app.composePath = dto.composePath.trim() || 'docker-compose.yml';
    }
    if (dto.gitCredentialId !== undefined) {
      if (dto.gitCredentialId) {
        await this.credentials.findOrFail(dto.gitCredentialId);
      }
      app.gitCredentialId = dto.gitCredentialId;
    }
    if (dto.env !== undefined) {
      app.env = dto.env;
      // A ${{vars.KEY}} missing from the linked variable sets is a 400 now.
      await this.variableSets.checkReferences(
        { kind: 'compose', id: app.id, projectId: app.projectId },
        asTarget(app),
      );
    }
    if (dto.composeContent !== undefined) {
      if (app.source !== 'template') {
        throw new BadRequestException(
          'composeContent can only be edited on template stacks',
        );
      }
      app.composeContent = dto.composeContent;
    }
    if (dto.serviceDomains !== undefined) {
      app.serviceDomains = dto.serviceDomains.map((d) => ({
        service: d.service,
        port: d.port,
        host: d.host.trim().toLowerCase(),
        https: d.https,
      }));
    }
    if (dto.servicePorts !== undefined) {
      app.servicePorts = dto.servicePorts.map((p) => ({
        service: p.service,
        port: p.port,
        hostPort: p.hostPort,
        ...(p.bind ? { bind: normalizeBind(p.bind) } : {}),
      }));
      await this.compose.assertHostPortsFree(app);
    }
    if (dto.serviceResources !== undefined) {
      app.serviceResources = dto.serviceResources.map((r) => ({
        service: r.service,
        cpuMillicores: r.cpuMillicores ?? null,
        memoryMb: r.memoryMb ?? null,
      }));
    }
    return this.compose.repo.save(app);
  }
}
