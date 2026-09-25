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
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import type { Request } from 'express';
import {
  ComposeWebhookResultDto,
  WebhookDeployComposeService,
} from './webhook-deploy-compose.service';

export class ComposeWebhookParamsDto {
  @IsString()
  @Length(10, 200)
  token: string;
}

/** Public endpoint (no JWT): called by GitHub/GitLab on push to a stack's repo. */
@Controller('webhooks/compose')
export class WebhookDeployComposeController {
  constructor(private readonly service: WebhookDeployComposeService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  handle(
    @Param() params: ComposeWebhookParamsDto,
    @Body() payload: Record<string, unknown>,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') githubEvent?: string,
    @Headers('x-gitlab-event') gitlabEvent?: string,
    @Headers('x-hub-signature-256') hubSignature256?: string,
    @Headers('x-gitlab-token') gitlabToken?: string,
  ): Promise<ComposeWebhookResultDto> {
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
