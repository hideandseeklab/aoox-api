import { IsString, Length } from 'class-validator';

export class WebhookParamsDto {
  @IsString()
  @Length(20, 64)
  token: string;
}

export class WebhookResponseDto {
  /** `queued` = deployment started; `ignored` = event/branch not relevant; `busy` = one already running. */
  result: 'queued' | 'ignored' | 'busy' | 'preview' | 'preview-closed';
  reason?: string;
  deploymentId?: string;
  previewId?: string;
}
