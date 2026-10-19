import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Application } from '../../application/application.entity';
import { OwnerVariableSetsService } from '../../application/variable-set-links/variable-set-links.service';
import { GitCredentialService } from '../../git-credential/git-credential.service';
import { ProjectService } from '../../project/project.service';
import { ComposeApp } from '../compose-app.entity';
import { ComposeService } from '../compose.service';
import { CreateComposeAppDto } from './create-compose-app.dto';

@Injectable()
export class CreateComposeAppService {
  constructor(
    private readonly compose: ComposeService,
    private readonly projects: ProjectService,
    private readonly credentials: GitCredentialService,
    private readonly variableSets: OwnerVariableSetsService,
  ) {}

  async execute(
    ownerId: string,
    dto: CreateComposeAppDto,
  ): Promise<ComposeApp> {
    const project = await this.projects.findOwnedOrFail(dto.projectId, ownerId);
    if (dto.gitCredentialId) {
      await this.credentials.findOrFail(dto.gitCredentialId);
    }
    const app = this.compose.repo.create({
      projectId: project.id,
      project,
      name: dto.name.trim(),
      slug: ComposeService.slugify(dto.name),
      gitUrl: dto.gitUrl.trim(),
      gitBranch: dto.gitBranch?.trim() || 'main',
      gitCredentialId: dto.gitCredentialId ?? null,
      composePath: dto.composePath?.trim() || 'docker-compose.yml',
      env: dto.env ?? '',
      webhookToken: randomBytes(24).toString('base64url'),
      status: 'idle',
    });
    // Without links the stack has none (no default environment). The env is
    // validated against the requested links (400 now, not a failed deploy).
    const links = (dto.variableSetLinks ?? []).map((l) => l.environmentId);
    const owner = { kind: 'compose' as const, projectId: project.id };
    await this.variableSets.check(owner, asTarget(app), links, ownerId);
    const saved = await this.compose.repo.save(app);
    if (links.length > 0) {
      await this.variableSets.replace(
        { ...owner, id: saved.id },
        asTarget(saved),
        links,
        ownerId,
      );
    }
    // The entity still carries the webhook token it was built with.
    const { webhookToken: _omit, ...safe } = saved;
    void _omit;
    return safe as ComposeApp;
  }
}

/** The resolver takes an `Application`; a stack has the fields it reads. */
export function asTarget(app: ComposeApp): Application {
  return app as unknown as Application;
}
