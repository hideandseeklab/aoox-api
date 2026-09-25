import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { WebhookInfoDto } from '../get-webhook/get-webhook.dto';
import { GetWebhookService } from '../get-webhook/get-webhook.service';

/** Invalidates the old webhook URL by issuing a new token. */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class RegenerateWebhookController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly getWebhook: GetWebhookService,
  ) {}

  @Post(':id/webhook/regenerate')
  @HttpCode(HttpStatus.OK)
  async regenerate(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<WebhookInfoDto> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    await this.applications.repo.update(app.id, {
      webhookToken: randomBytes(24).toString('base64url'),
    });
    return this.getWebhook.execute(user.sub, app.id);
  }
}
