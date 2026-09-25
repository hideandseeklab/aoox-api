export class WebhookInfoDto {
  /** Absolute URL to configure at the git provider. */
  url: string;
  token: string;
  branch: string;
  /** Shown so it can be pasted at the provider; null = signature check off. */
  secret: string | null;
}
