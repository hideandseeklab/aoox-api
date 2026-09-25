import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookAuthHeaders {
  /** GitHub: `sha256=<hex HMAC-SHA256 of the raw body>`. */
  hubSignature256?: string;
  /** GitLab: the secret itself, sent verbatim. */
  gitlabToken?: string;
}

/**
 * Checks a provider's proof of the shared secret. GitHub signs the raw
 * request body (docs: "Validating webhook deliveries"); GitLab just sends the
 * secret as `X-Gitlab-Token`. Either one is enough. Comparisons are
 * constant-time; a missing/short header simply fails.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: Buffer | undefined,
  headers: WebhookAuthHeaders,
): boolean {
  if (headers.hubSignature256 && rawBody) {
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    if (safeEqual(expected, headers.hubSignature256)) return true;
  }
  if (headers.gitlabToken && safeEqual(secret, headers.gitlabToken)) {
    return true;
  }
  return false;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
