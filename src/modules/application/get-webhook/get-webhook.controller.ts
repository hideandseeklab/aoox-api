import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { WebhookInfoDto } from './get-webhook.dto';
import { GetWebhookService } from './get-webhook.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class GetWebhookController {
  constructor(private readonly service: GetWebhookService) {}

  @Get(':id/webhook')
  get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<WebhookInfoDto> {
    return this.service.execute(user.sub, params.id);
  }
}
