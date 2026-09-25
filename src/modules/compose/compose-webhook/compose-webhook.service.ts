import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret } from '../../docker/secret.util';
import { ComposeApp } from '../compose-app.entity';
import { ComposeService } from '../compose.service';

export interface ComposeWebhookInfoDto {
  /** Full URL to paste into GitHub/GitLab. */
  url: string;
  token: string;
  /** Pushes to this branch trigger a redeploy. */
  branch: string;
  /** Shared secret, when one is set (shown so it can be copied again). */
  secret: string | null;
  /** Template stacks have no repository, so a push has nothing to redeploy. */
  supported: boolean;
}

@Injectable()
export class ComposeWebhookService {
  constructor(
    private readonly compose: ComposeService,
    private readonly config: ConfigService,
  ) {}

  async info(ownerId: string, id: string): Promise<ComposeWebhookInfoDto> {
    const app = await this.compose.findOwnedOrFail(id, ownerId);
    const { webhookToken, webhookSecretEncrypted } = await this.withSecrets(
      app.id,
    );
    return {
      url: `${this.publicApiUrl()}/webhooks/compose/${webhookToken}`,
      token: webhookToken,
      branch: app.gitBranch,
      secret: webhookSecretEncrypted
        ? decryptSecret(
            webhookSecretEncrypted,
            this.config.getOrThrow<string>('ENCRYPTION_KEY'),
          )
        : null,
      supported: app.source === 'git',
    };
  }

  /** The two `select: false` columns, which a plain find never returns. */
  withSecrets(id: string): Promise<ComposeApp> {
    return this.compose.repo
      .createQueryBuilder('app')
      .addSelect(['app.webhookToken', 'app.webhookSecretEncrypted'])
      .where('app.id = :id', { id })
      .getOneOrFail();
  }

  /** Where git providers can reach this API (PUBLIC_API_URL), no trailing slash. */
  private publicApiUrl(): string {
    return (
      this.config.get<string>('PUBLIC_API_URL') ??
      `http://localhost:${this.config.get<string>('PORT') ?? 3001}`
    ).replace(/\/+$/, '');
  }
}
