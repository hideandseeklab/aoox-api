import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { In } from 'typeorm';
import { SecretSourceError } from '../../secret-source/infisical.client';
import { SecretSourceService } from '../../secret-source/secret-source.service';
import { ApplicationService } from '../application.service';
import { UpdateSecretSourceDto } from './update-secret-source.dto';
import { SecretSourceView, secretSourceView } from './secret-source-view';

const ACTIVE = ['queued', 'building', 'pushing', 'starting'] as const;

@Injectable()
export class SecretSourceAppService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly secrets: SecretSourceService,
  ) {}

  /** Sets or detaches the application's secret source (developers and up; viewers fail the project write check). */
  async update(
    userId: string,
    id: string,
    dto: UpdateSecretSourceDto,
  ): Promise<{ secretSource: SecretSourceView | null }> {
    const app = await this.applications.findOwnedOrFail(id, userId);
    // The runner holds a copy of the entity for the whole deployment and saves
    // it back at the end, which would undo this change (same reason as host port).
    const busy = await this.applications.deployments.exists({
      where: { applicationId: app.id, status: In([...ACTIVE]) },
    });
    if (busy) {
      throw new ConflictException(
        'A deployment is in progress; change the secret source when it has finished',
      );
    }
    if (!dto.connectionId) {
      await this.applications.repo.update(app.id, {
        secretConnectionId: null,
        secretProjectId: null,
        secretEnvironment: null,
        secretPath: '/',
        secretSync: false,
      });
      return { secretSource: null };
    }
    const conn = await this.secrets.findOrFail(dto.connectionId);
    const patch = {
      secretConnectionId: conn.id,
      secretProjectId: dto.projectId!.trim(),
      secretEnvironment: dto.environment!.trim(),
      secretPath: dto.path?.trim() || '/',
      secretSync: dto.sync ?? false,
    };
    await this.applications.repo.update(app.id, patch);
    return { secretSource: secretSourceView({ ...patch }, conn.name) };
  }

  /** Names of the secrets at the saved source, never values (a successful login and list = it works). */
  async preview(userId: string, id: string): Promise<{ keys: string[] }> {
    const app = await this.applications.findOwnedOrFail(id, userId);
    if (!app.secretConnectionId || !app.secretProjectId) {
      throw new BadRequestException('This application has no secret source');
    }
    try {
      const secrets = await this.secrets.fetch(app.secretConnectionId, {
        projectId: app.secretProjectId,
        environment: app.secretEnvironment ?? '',
        path: app.secretPath || '/',
      });
      return { keys: [...secrets.keys()].sort() };
    } catch (err) {
      if (err instanceof SecretSourceError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
