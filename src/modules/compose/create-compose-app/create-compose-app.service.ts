import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Application } from '../../application/application.entity';
import {
  EnvReferenceError,
  EnvResolverService,
} from '../../application/env-resolver.service';
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
    private readonly envResolver: EnvResolverService,
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
    await validateEnv(this.envResolver, app);
    return this.compose.repo.save(app);
  }
}

/** Same reference validation as applications (400 now, not a failed deploy later). */
export async function validateEnv(
  resolver: EnvResolverService,
  app: ComposeApp,
): Promise<void> {
  try {
    await resolver.resolve(app as unknown as Application);
  } catch (err) {
    if (err instanceof EnvReferenceError) {
      throw new BadRequestException(err.message);
    }
    throw err;
  }
}
