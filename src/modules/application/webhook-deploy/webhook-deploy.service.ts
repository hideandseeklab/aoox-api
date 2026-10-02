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
  created?: boolean; // GitHub
  forced?: boolean; // GitHub
  // GitHub push
  after?: string;
  head_commit?: { message?: string };
  pusher?: { name?: string };
  // GitLab push
  checkout_sha?: string;
  total_commits_count?: number;
  commits?: PushedCommit[];
  user_name?: string;
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

/** A commit of a push payload; file lists are what `watchRootOnly` reads (GitHub and GitLab both send them). */
interface PushedCommit {
  message?: string;
  added?: string[];
  modified?: string[];
  removed?: string[];
}

const COMMIT_MESSAGE_MAX = 200;

/** Both providers cap `commits[]` at 20 entries. */
const PAYLOAD_COMMIT_CAP = 20;

/**
 * `watchRootOnly`: does this push touch anything under `root`? Answers `true`
 * (deploy) whenever it cannot tell — no root, no/empty commit list, a list
 * that hit the providers' 20-commit cap or is shorter than the provider's
 * own total, a forced push or new branch (the list may not cover the change),
 * or any commit without file lists (GitHub leaves them empty for merge
 * commits). Only a payload that positively shows every changed file outside
 * `root` returns `false`.
 */
export function pushTouchesRoot(
  payload: PushPayload,
  root: string | null | undefined,
): boolean {
  if (!root) return true;
  const commits = payload.commits;
  if (!Array.isArray(commits) || commits.length === 0) return true;
  if (commits.length >= PAYLOAD_COMMIT_CAP) return true;
  if (
    typeof payload.total_commits_count === 'number' &&
    payload.total_commits_count > commits.length
  ) {
    return true;
  }
  if (payload.forced || payload.created) return true;
  const prefix = `${root}/`;
  for (const commit of commits) {
    const files = [
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? []),
    ];
    if (
      !Array.isArray(commit.added) ||
      !Array.isArray(commit.modified) ||
      !Array.isArray(commit.removed) ||
      files.length === 0
    ) {
      return true;
    }
    if (files.some((f) => f === root || f.startsWith(prefix))) return true;
  }
  return false;
}

export interface PushCommitInfo {
  sha: string | null;
  message: string | null;
  pusherName: string | null;
}

/**
 * Commit + pusher off a push payload — GitHub's `after`/`head_commit`/
 * `pusher`, or GitLab's `checkout_sha`/last of `commits`/`user_name`. Only
 * the first line of the message is kept, truncated, since it ends up in the
 * deployment log and history list, not a scrollable diff view.
 */
export function parsePushCommit(payload: PushPayload): PushCommitInfo {
  const sha = payload.after ?? payload.checkout_sha ?? null;
  const rawMessage =
    payload.head_commit?.message ??
    payload.commits?.[payload.commits.length - 1]?.message ??
    null;
  const message = rawMessage
    ? rawMessage.split('\n')[0].slice(0, COMMIT_MESSAGE_MAX)
    : null;
  const pusherName = payload.pusher?.name ?? payload.user_name ?? null;
  return { sha, message, pusherName };
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

    if (
      app.sourceType !== 'image' &&
      app.watchRootOnly &&
      !pushTouchesRoot(payload, app.rootDirectory)
    ) {
      return {
        result: 'ignored',
        reason: `no changes under ${app.rootDirectory}`,
      };
    }

    try {
      const commit = parsePushCommit(payload);
      const deployment = await this.deploys.queue(app, 'build', {
        trigger: 'webhook',
        commitSha: commit.sha,
        commitMessage: commit.message,
        triggeredBy: commit.pusherName,
      });
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
