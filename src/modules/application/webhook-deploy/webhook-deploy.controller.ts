import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { WebhookParamsDto, WebhookResponseDto } from './webhook-deploy.dto';
import { WebhookDeployService } from './webhook-deploy.service';

/** Public endpoint (no JWT): called by GitHub/GitLab on push. */
@Controller('webhooks')
export class WebhookDeployController {
  constructor(private readonly service: WebhookDeployService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  handle(
    @Param() params: WebhookParamsDto,
    @Body() payload: Record<string, unknown>,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') githubEvent?: string,
    @Headers('x-gitlab-event') gitlabEvent?: string,
    @Headers('x-hub-signature-256') hubSignature256?: string,
    @Headers('x-gitlab-token') gitlabToken?: string,
  ): Promise<WebhookResponseDto> {
    return this.service.execute(
      params.token,
      payload,
      githubEvent ?? gitlabEvent,
      {
        rawBody: req.rawBody,
        headers: { hubSignature256, gitlabToken },
        sourceIp: req.ip,
        isGithub: !!(githubEvent || hubSignature256),
      },
    );
  }
}
