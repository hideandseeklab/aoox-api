import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { encryptSecret } from '../../docker/secret.util';
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeService } from '../compose.service';
import {
  ComposeWebhookInfoDto,
  ComposeWebhookService,
} from './compose-webhook.service';

/**
 * Managing a stack's webhook: read the URL, rotate the token, set or clear
 * the shared secret. Deliveries themselves land on the public endpoint in
 * `webhook-deploy-compose/`.
 */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class ComposeWebhookController {
  constructor(
    private readonly compose: ComposeService,
    private readonly webhook: ComposeWebhookService,
    private readonly config: ConfigService,
  ) {}

  @Get(':id/webhook')
  get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeWebhookInfoDto> {
    return this.webhook.info(user.sub, params.id);
  }

  /** Invalidates the old URL immediately (paste the new one in the provider). */
  @Post(':id/webhook/regenerate')
  async regenerate(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeWebhookInfoDto> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    await this.compose.repo.update(app.id, {
      webhookToken: randomBytes(24).toString('base64url'),
    });
    return this.webhook.info(user.sub, app.id);
  }

  @Put(':id/webhook/secret')
  async rotateSecret(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeWebhookInfoDto> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    await this.compose.repo.update(app.id, {
      webhookSecretEncrypted: encryptSecret(
        randomBytes(32).toString('base64url'),
        this.config.getOrThrow<string>('ENCRYPTION_KEY'),
      ),
    });
    return this.webhook.info(user.sub, app.id);
  }

  @Delete(':id/webhook/secret')
  @HttpCode(HttpStatus.OK)
  async disableSecret(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<ComposeWebhookInfoDto> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    await this.compose.repo.update(app.id, { webhookSecretEncrypted: null });
    return this.webhook.info(user.sub, app.id);
  }
}
