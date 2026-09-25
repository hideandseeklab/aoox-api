import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { decryptSecret } from '../../docker/secret.util';
import { ApplicationService } from '../application.service';
import { DeployApplicationService } from '../deploy-application/deploy-application.service';
import { PreviewService } from '../preview.service';
import { WebhookResponseDto } from './webhook-deploy.dto';
import {
  verifyWebhookSignature,
  WebhookAuthHeaders,
} from './webhook-signature';
import { githubHookRanges, isGithubHookIp } from './webhook-ip-allowlist';

/** Push payload fields we look at; GitHub and GitLab both send `ref`. */
interface PushPayload {
  ref?: string;
  object_kind?: string; // GitLab
  deleted?: boolean; // GitHub
  // GitHub pull_request
  action?: string;
  number?: number;
  pull_request?: {
    title?: string;
    html_url?: string;
    head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
    base?: { repo?: { full_name?: string } };
  };
  // GitLab merge_request
  object_attributes?: {
    action?: string;
    iid?: number;
    title?: string;
    url?: string;
    source_branch?: string;
    last_commit?: { id?: string };
    source_project_id?: number;
    target_project_id?: number;
  };
}

/** Provider-neutral view of a PR event. */
interface PullRequestEvent {
  kind: 'update' | 'close';
  number: number;
  title: string;
  branch: string;
  sha: string | null;
  url: string | null;
  fromFork: boolean;
}

/** GitHub `pull_request` / GitLab `Merge Request Hook` -> one shape; null when not a PR event. */
export function parsePullRequest(
  payload: PushPayload,
  event: string | undefined,
): PullRequestEvent | null {
  if (event === 'pull_request' && payload.pull_request) {
    const pr = payload.pull_request;
    const action = payload.action ?? '';
    const kind = ['opened', 'synchronize', 'reopened'].includes(action)
      ? 'update'
      : action === 'closed'
        ? 'close'
        : null;
    if (!kind || !payload.number || !pr.head?.ref) return null;
    return {
      kind,
      number: payload.number,
      title: pr.title ?? `PR #${payload.number}`,
      branch: pr.head.ref,
      sha: pr.head.sha ?? null,
      url: pr.html_url ?? null,
      fromFork:
        !!pr.head.repo?.full_name &&
        pr.head.repo.full_name !== pr.base?.repo?.full_name,
    };
  }
  if (payload.object_kind === 'merge_request' && payload.object_attributes) {
    const mr = payload.object_attributes;
    const action = mr.action ?? '';
    const kind = ['open', 'update', 'reopen'].includes(action)
      ? 'update'
      : ['close', 'merge'].includes(action)
        ? 'close'
        : null;
    if (!kind || !mr.iid || !mr.source_branch) return null;
    return {
      kind,
      number: mr.iid,
      title: mr.title ?? `MR !${mr.iid}`,
      branch: mr.source_branch,
      sha: mr.last_commit?.id ?? null,
      url: mr.url ?? null,
      fromFork:
        mr.source_project_id !== undefined &&
        mr.target_project_id !== undefined &&
        mr.source_project_id !== mr.target_project_id,
    };
  }
  return null;
}

/** What the provider sent to prove it knows the secret (if one is set). */
export interface WebhookAuth {
  rawBody: Buffer | undefined;
  headers: WebhookAuthHeaders;
  /** Caller's address (`req.ip`), for the optional GitHub IP check below. */
  sourceIp?: string;
  /** `X-GitHub-Event` or `X-Hub-Signature-256` was present on the request. */
  isGithub?: boolean;
}

/**
 * Deploys on push events from a git provider. Auth is the unguessable token
 * in the URL, plus — when the app has a webhook secret — a GitHub HMAC
 * signature or GitLab token (401 otherwise). Unrelated branches are
 * acknowledged with 200 so providers do not disable the hook.
 *
 * Optional second layer, `WEBHOOK_VERIFY_GITHUB_IP=true`: a GitHub delivery
 * (identified by its headers) must also originate from one of GitHub's
 * published webhook ranges (`webhook-ip-allowlist.ts`), on top of the
 * signature. Off by default and GitHub-only — GitLab does not publish a
 * stable set of webhook source IPs (self-hosted GitLab can be anywhere), and
 * GitHub *Enterprise Server* (self-hosted) sends `X-GitHub-Event` too but
 * from the customer's own network, not github.com's ranges, so turning this
 * on there would reject every real delivery.
 */
@Injectable()
export class WebhookDeployService {
  private readonly logger = new Logger(WebhookDeployService.name);

  constructor(
    private readonly applications: ApplicationService,
    private readonly deploys: DeployApplicationService,
    private readonly previews: PreviewService,
    private readonly config: ConfigService,
  ) {}

  async execute(
    token: string,
    payload: PushPayload,
    event: string | undefined,
    auth: WebhookAuth = { rawBody: undefined, headers: {} },
  ): Promise<WebhookResponseDto> {
    const app = await this.applications.repo
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
      this.logger.warn(`Webhook for ${app.appName}: bad or missing signature`);
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
          `Webhook for ${app.appName}: source ${auth.sourceIp ?? '?'} not in GitHub's published ranges`,
        );
        throw new UnauthorizedException(
          "Source address is not in GitHub's published webhook ranges",
        );
      }
    }

    // Pull-request events drive previews (opt-in per app, never from forks).
    const pr = parsePullRequest(payload, event);
    if (pr) {
      if (!app.previewsEnabled) {
        return { result: 'ignored', reason: 'previews disabled' };
      }
      if (pr.kind === 'close') {
        const existing = await this.previews.findByPr(app.id, pr.number);
        const previewId = existing?.id; // remove() clears the entity's id
        if (existing) await this.previews.destroy(app, existing);
        return { result: 'preview-closed', previewId };
      }
      if (pr.fromFork) return { result: 'ignored', reason: 'fork' };
      const preview = await this.previews.upsert(app, pr);
      if (!preview) return { result: 'ignored', reason: 'preview limit' };
      this.logger.log(
        `Webhook queued preview PR #${pr.number} for ${app.appName}`,
      );
      return { result: 'preview', previewId: preview.id };
    }

    // Only pushes to the configured branch. GitHub sends X-GitHub-Event,
    // GitLab X-Gitlab-Event ("Push Hook") and object_kind.
    const isPush =
      !event ||
      event === 'push' ||
      event.toLowerCase().includes('push') ||
      payload.object_kind === 'push';
    if (!isPush)
      return { result: 'ignored', reason: `event ${event ?? 'unknown'}` };
    if (payload.deleted) return { result: 'ignored', reason: 'branch deleted' };
    // Image apps have no branch: any push-like call (e.g. from a CI job
    // after `docker push`) re-pulls the reference.
    const expectedRef = `refs/heads/${app.gitBranch}`;
    if (
      app.sourceType !== 'image' &&
      payload.ref &&
      payload.ref !== expectedRef
    ) {
      return {
        result: 'ignored',
        reason: `ref ${payload.ref} != ${expectedRef}`,
      };
    }

    try {
      const deployment = await this.deploys.queue(app);
      this.logger.log(
        `Webhook queued deployment ${deployment.id} for ${app.appName}`,
      );
      return { result: 'queued', deploymentId: deployment.id };
    } catch (err) {
      // A deployment already running: acknowledge instead of failing the hook.
      return { result: 'busy', reason: (err as Error).message };
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
