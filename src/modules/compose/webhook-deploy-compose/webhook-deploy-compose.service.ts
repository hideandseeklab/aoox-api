import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import {
  githubHookRanges,
  isGithubHookIp,
} from '../../application/webhook-deploy/webhook-ip-allowlist';
import {
  verifyWebhookSignature,
  WebhookAuthHeaders,
} from '../../application/webhook-deploy/webhook-signature';
import { decryptSecret } from '../../docker/secret.util';
import { ComposeRunnerService } from '../compose-runner.service';
import { ComposeService } from '../compose.service';

/** The push fields both providers send; a stack has no PR/preview handling. */
interface PushPayload {
  ref?: string;
  object_kind?: string;
  deleted?: boolean;
  after?: string;
  checkout_sha?: string;
  head_commit?: { id?: string };
}

export interface ComposeWebhookResultDto {
  result: 'queued' | 'busy' | 'ignored';
  deploymentId?: string;
  reason?: string;
}

export interface ComposeWebhookAuth {
  rawBody: Buffer | undefined;
  headers: WebhookAuthHeaders;
  /** See `WebhookDeployService` (application module) for both of these. */
  sourceIp?: string;
  isGithub?: boolean;
}

/**
 * Redeploys a stack on push, the same contract applications have: the URL
 * token authenticates, an optional secret is proven per delivery, and
 * anything unrelated is acknowledged with 200 so the provider keeps the
 * hook enabled.
 */
@Injectable()
export class WebhookDeployComposeService {
  private readonly logger = new Logger(WebhookDeployComposeService.name);

  constructor(
    private readonly compose: ComposeService,
    private readonly runner: ComposeRunnerService,
    private readonly config: ConfigService,
  ) {}

  async execute(
    token: string,
    payload: PushPayload,
    event: string | undefined,
    auth: ComposeWebhookAuth = { rawBody: undefined, headers: {} },
  ): Promise<ComposeWebhookResultDto> {
    const app = await this.compose.repo
      .createQueryBuilder('app')
      .addSelect(['app.webhookToken', 'app.webhookSecretEncrypted'])
      .leftJoinAndSelect('app.project', 'project')
      .where('app.webhookToken = :token', { token })
      .getOne();
    if (!app || !safeEqual(app.webhookToken, token)) {
      throw new NotFoundException('Unknown webhook');
    }
    const secret = app.webhookSecretEncrypted
      ? decryptSecret(
          app.webhookSecretEncrypted,
          this.config.getOrThrow<string>('ENCRYPTION_KEY'),
        )
      : null;
    if (secret && !verifyWebhookSignature(secret, auth.rawBody, auth.headers)) {
      this.logger.warn(`Webhook for ${app.slug}: bad or missing signature`);
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (
      secret &&
      auth.isGithub &&
      this.config.get<string>('WEBHOOK_VERIFY_GITHUB_IP') === 'true'
    ) {
      const ranges = await githubHookRanges();
      if (ranges.length > 0 && !isGithubHookIp(auth.sourceIp, ranges)) {
        this.logger.warn(
          `Webhook for ${app.slug}: source ${auth.sourceIp ?? '?'} not in GitHub's published ranges`,
        );
        throw new UnauthorizedException(
          "Source address is not in GitHub's published webhook ranges",
        );
      }
    }

    // A template stack's compose file lives in the database, so there is no
    // repository a push could change.
    if (app.source !== 'git') {
      return { result: 'ignored', reason: 'template stack' };
    }
    const isPush =
      !event ||
      event === 'push' ||
      event.toLowerCase().includes('push') ||
      payload.object_kind === 'push';
    if (!isPush) {
      return { result: 'ignored', reason: `event ${event ?? 'unknown'}` };
    }
    if (payload.deleted) return { result: 'ignored', reason: 'branch deleted' };
    const expectedRef = `refs/heads/${app.gitBranch}`;
    if (payload.ref && payload.ref !== expectedRef) {
      return {
        result: 'ignored',
        reason: `ref ${payload.ref} != ${expectedRef}`,
      };
    }
    if (this.runner.isActive(app.id)) {
      // Acknowledge instead of queueing: the run in flight is already
      // cloning the branch, so it picks up this commit or the next push does.
      return { result: 'busy', reason: 'a compose action is still running' };
    }

    const commitSha =
      payload.head_commit?.id ?? payload.after ?? payload.checkout_sha ?? null;
    const run = await this.runner.queue(app, 'deploy', {
      trigger: 'webhook',
      commitSha,
    });
    this.logger.log(`Webhook queued compose deploy for ${app.slug}`);
    return { result: 'queued', deploymentId: run.id };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
