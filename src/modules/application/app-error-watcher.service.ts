import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { RemoteDockerService } from '../server/remote-docker.service';
import { NotificationService } from '../notification/notification.service';
import { Application } from './application.entity';
import { ApplicationService, containerNameFor } from './application.service';
import { EnvResolverService, parseEnvLines } from './env-resolver.service';
import { detectLogErrors, LogErrorEvent } from './log-error-detector';
import { SwarmDeployService } from './swarm-deploy.service';

/** One notification per app per window, unless a never-seen-before fingerprint shows up. */
const COOLDOWN_MS = 15 * 60_000;
/** At most this many distinct error shapes get an example snippet per notification. */
const MAX_EXAMPLES = 3;
const SNIPPET_MAX_CHARS = 300;

/**
 * Every minute, scans each running application's container log for lines
 * written since the last tick (see `log-error-detector.ts` for the pattern
 * matching) and turns matches into an "Application error" notification —
 * off by default (`on_app_error`) since log-based detection is inherently
 * prone to false positives, and skippable per app via
 * `Application.ignoreErrorLogs` for apps whose normal output is just noisy.
 *
 * Polls `GET /containers/{id}/logs?since=<cursor>` rather than keeping a
 * permanent `follow` stream per container (like `logs.gateway.ts` does for
 * the UI) — lighter on the daemon with many apps, and the cursor survives
 * fine across API restarts (worst case: a one-minute gap is rescanned, or a
 * fresh container starts its cursor at "now" and never sees history).
 *
 * Compose stacks and preview deployments are out of scope (see AGENTS.md).
 */
@Injectable()
export class AppErrorWatcherService {
  private readonly logger = new Logger(AppErrorWatcherService.name);
  /** Container id -> unix seconds of the last tick's log fetch. */
  private readonly cursorSeconds = new Map<string, number>();
  /** Application id -> fingerprints already notified at least once since boot. */
  private readonly seenFingerprints = new Map<string, Set<string>>();
  /** Application id -> last notification time (ms). */
  private readonly lastNotified = new Map<string, number>();

  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly envResolver: EnvResolverService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    const apps = await this.applications.repo.find({
      where: { status: 'running', ignoreErrorLogs: false },
      relations: { project: true },
    });
    const activeContainers = new Set<string>();
    const activeApps = new Set<string>();
    for (const app of apps) {
      activeApps.add(app.id);
      try {
        await this.checkApp(app, activeContainers);
      } catch (err) {
        this.logger.warn(
          `Error-log check for ${app.name} failed: ${String(err)}`,
        );
      }
    }
    for (const id of [...this.cursorSeconds.keys()]) {
      if (!activeContainers.has(id)) this.cursorSeconds.delete(id);
    }
    for (const id of [...this.seenFingerprints.keys()]) {
      if (!activeApps.has(id)) this.seenFingerprints.delete(id);
    }
    for (const id of [...this.lastNotified.keys()]) {
      if (!activeApps.has(id)) this.lastNotified.delete(id);
    }
  }

  private async checkApp(
    app: Application,
    activeContainers: Set<string>,
  ): Promise<void> {
    const containerIds = await this.containersFor(app);
    if (containerIds.length === 0) return;
    const docker = await this.remote.forServer(app.serverId);

    const events: LogErrorEvent[] = [];
    for (const id of containerIds) {
      activeContainers.add(id);
      const now = Math.floor(Date.now() / 1000);
      const since = this.cursorSeconds.get(id);
      this.cursorSeconds.set(id, now);
      // First sighting of this container: baseline the cursor to "now" so a
      // freshly deployed/restarted container's existing log history never
      // triggers a notification — only what it writes from here on does.
      if (since === undefined) continue;
      const text = await docker.engine
        .containerLogsSince(id, since)
        .catch(() => '');
      if (text) events.push(...detectLogErrors(text));
    }
    if (events.length > 0) await this.notify(app, events);
  }

  private async containersFor(app: Application): Promise<string[]> {
    if (app.deployMode === 'service') {
      return this.swarmDeploy.taskContainers(app);
    }
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker.findContainerByName(containerNameFor(app));
    return c ? [c.Id] : [];
  }

  private async notify(
    app: Application,
    events: LogErrorEvent[],
  ): Promise<void> {
    const seen = this.seenFingerprints.get(app.id) ?? new Set<string>();
    const hasNewFingerprint = events.some((e) => !seen.has(e.fingerprint));
    for (const e of events) seen.add(e.fingerprint);
    this.seenFingerprints.set(app.id, seen);

    const now = Date.now();
    const last = this.lastNotified.get(app.id) ?? 0;
    if (!hasNewFingerprint && now - last < COOLDOWN_MS) return;
    this.lastNotified.set(app.id, now);

    const redactValues = await this.redactionValues(app);
    const uniqueByFingerprint = [
      ...new Map(events.map((e) => [e.fingerprint, e])).values(),
    ];
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();

    const fields: Array<[string, string]> = [
      ['Application', app.name],
      ['Project', app.project.name],
      ['Errors this check', String(events.length)],
    ];
    for (const [i, e] of uniqueByFingerprint.slice(0, MAX_EXAMPLES).entries()) {
      const snippet = this.redact(e.lines.join('\n'), redactValues).slice(
        0,
        SNIPPET_MAX_CHARS,
      );
      fields.push([`Example ${i + 1}`, snippet]);
    }

    this.logger.warn(`${events.length} error(s) detected in ${app.name}'s log`);
    await this.notifications
      .broadcast('appError', {
        title: `Application error detected: ${app.name}`,
        level: 'failure',
        fields,
        url: origin ? `${origin}/applications/${app.id}` : undefined,
        data: {
          event: 'app.error',
          applicationId: app.id,
          count: events.length,
          fingerprints: uniqueByFingerprint.map((e) => e.fingerprint),
        },
      })
      .catch((err) =>
        this.logger.warn(`App-error notification failed: ${String(err)}`),
      );
  }

  /**
   * Values that must never appear in a notification: resolved database
   * passwords (same set `DeploymentLog.redact` registers during a deploy)
   * plus any raw env value whose key looks like a secret — a snippet from a
   * live container's log isn't run through that redaction path otherwise.
   */
  private async redactionValues(app: Application): Promise<string[]> {
    const values = new Set<string>();
    for (const [key, value] of parseEnvLines(app.env)) {
      if (/PASSWORD|SECRET|TOKEN|KEY/i.test(key) && value) values.add(value);
    }
    try {
      const resolved = await this.envResolver.resolve(app);
      for (const secret of resolved.secrets) if (secret) values.add(secret);
    } catch {
      // A broken ${{...}} reference is already surfaced elsewhere
      // (update-application, deploy); this watcher just skips it.
    }
    return [...values];
  }

  private redact(text: string, values: string[]): string {
    let out = text;
    for (const v of values) out = out.split(v).join('***');
    return out;
  }
}
