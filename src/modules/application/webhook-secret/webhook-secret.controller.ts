import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { encryptSecret } from '../../docker/secret.util';
import { ApplicationService } from '../application.service';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { WebhookInfoDto } from '../get-webhook/get-webhook.dto';
import { GetWebhookService } from '../get-webhook/get-webhook.service';

/**
 * Shared secret the provider proves it knows on every delivery (GitHub
 * `X-Hub-Signature-256`, GitLab `X-Gitlab-Token`). PUT generates or rotates
 * it; DELETE goes back to URL-token-only auth.
 */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class WebhookSecretController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly getWebhook: GetWebhookService,
    private readonly config: ConfigService,
  ) {}

  @Put(':id/webhook/secret')
  async rotate(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<WebhookInfoDto> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    await this.applications.repo.update(app.id, {
      webhookSecretEncrypted: encryptSecret(
        randomBytes(32).toString('base64url'),
        this.config.getOrThrow<string>('ENCRYPTION_KEY'),
      ),
    });
    return this.getWebhook.execute(user.sub, app.id);
  }

  @Delete(':id/webhook/secret')
  @HttpCode(HttpStatus.OK)
  async disable(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<WebhookInfoDto> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    await this.applications.repo.update(app.id, {
      webhookSecretEncrypted: null,
    });
    return this.getWebhook.execute(user.sub, app.id);
  }
}
