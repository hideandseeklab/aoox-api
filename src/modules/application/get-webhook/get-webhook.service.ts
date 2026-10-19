import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProjectAccessService } from '../../project/project-access.service';
import { decryptSecret } from '../../docker/secret.util';
import { ApplicationService } from '../application.service';
import { WebhookInfoDto } from './get-webhook.dto';

@Injectable()
export class GetWebhookService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly config: ConfigService,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(
    ownerId: string,
    applicationId: string,
  ): Promise<WebhookInfoDto> {
    const app = await this.applications.findOwnedOrFail(applicationId, ownerId);
    // The token alone triggers deploys, so viewers do not get it.
    await this.access.assertCanExport(ownerId, app.project);
    const { webhookToken, webhookSecretEncrypted } =
      await this.applications.repo
        .createQueryBuilder('app')
        .addSelect(['app.webhookToken', 'app.webhookSecretEncrypted'])
        .where('app.id = :id', { id: app.id })
        .getOneOrFail();
    return {
      url: `${this.publicApiUrl()}/webhooks/${webhookToken}`,
      token: webhookToken,
      branch: app.gitBranch,
      secret: webhookSecretEncrypted
        ? decryptSecret(
            webhookSecretEncrypted,
            this.config.getOrThrow<string>('ENCRYPTION_KEY'),
          )
        : null,
    };
  }

  /** Where git providers can reach this API (PUBLIC_API_URL), no trailing slash. */
  private publicApiUrl(): string {
    return (
      this.config.get<string>('PUBLIC_API_URL') ??
      `http://localhost:${this.config.get<string>('PORT') ?? 3001}`
    ).replace(/\/+$/, '');
  }
}
