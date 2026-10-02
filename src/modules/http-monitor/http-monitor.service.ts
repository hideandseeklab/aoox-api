import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { Application } from '../application/application.entity';
import {
  Deployment,
  type DeploymentStatus,
} from '../application/deployment.entity';
import { Domain } from '../application/domain.entity';
import { NotificationMessage } from '../notification/notification-sender';
import { NotificationService } from '../notification/notification.service';
import { ProxyService } from '../proxy/proxy.service';
import { Server, proxySettingsOf } from '../server/server.entity';
import { HttpCheck } from './http-check.entity';
import { HttpIncident } from './http-incident.entity';
import { HttpMonitor } from './http-monitor.entity';
import {
  parseExpectedCodes,
  probe,
  statusIsHealthy,
  validateMonitorPath,
  type ProbeResult,
} from './http-probe';
import {
  formatDownTime,
  isDue,
  nextState,
  POST_DEPLOY_GRACE_MS,
  shouldRealert,
} from './monitor-state';

/** A deployment in one of these states is still building or starting the app. */
const ACTIVE_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  'queued',
  'building',
  'pushing',
  'starting',
];
/** Checks that run at the same time. */
export const CHECK_CONCURRENCY = 5;
/** Raw results older than this are dropped. */
export const CHECK_RETENTION_DAYS = 7;
/** ...and never more per monitor than one per minute for a week. */
export const CHECK_MAX_ROWS = 7 * 24 * 60;
export const INCIDENTS_KEEP = 50;

export type TargetSource = 'domain' | 'hostPort' | 'container';

export interface MonitorTarget {
  /** Full URL of the check (host + the monitor's path). */
  url: string;
  source: TargetSource;
}

export interface MonitorView {
  config: {
    enabled: boolean;
    path: string;
    intervalMinutes: number;
    timeoutSeconds: number;
    expectedCodes: string;
    failureThreshold: number;
    useInternal: boolean;
  };
  /** What the next check would request; null when the app has no reachable address. */
  target: MonitorTarget | null;
  targetError: string | null;
  status: {
    state: 'unknown' | 'up' | 'down';
    since: Date | null;
    lastCheckedAt: Date | null;
    lastStatusCode: number | null;
    lastLatencyMs: number | null;
    lastError: string | null;
    consecutiveFailures: number;
  };
  stats: {
    uptime24h: number | null;
    uptime7d: number | null;
    checks24h: number;
    avgLatencyMs24h: number | null;
    p95LatencyMs24h: number | null;
  };
  /** Last 24 h in up to 120 buckets, for the sparkline. */
  series: Array<{
    at: string;
    latencyMs: number | null;
    checks: number;
    failures: number;
  }>;
  incidents: Array<{
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    durationSeconds: number;
    reason: string | null;
    failedChecks: number;
  }>;
}

export const DEFAULT_CONFIG: MonitorView['config'] = {
  enabled: false,
  path: '/',
  intervalMinutes: 5,
  timeoutSeconds: 10,
  expectedCodes: '200-399',
  failureThreshold: 2,
  useInternal: false,
};

const inDocker = (): boolean => existsSync('/.dockerenv');

@Injectable()
export class HttpMonitorService {
  private readonly logger = new Logger(HttpMonitorService.name);
  private readonly inFlight = new Set<string>();
  private ticking = false;

  constructor(
    @InjectRepository(HttpMonitor)
    readonly monitors: Repository<HttpMonitor>,
    @InjectRepository(HttpCheck)
    private readonly checks: Repository<HttpCheck>,
    @InjectRepository(HttpIncident)
    private readonly incidents: Repository<HttpIncident>,
    @InjectRepository(Application)
    private readonly apps: Repository<Application>,
    @InjectRepository(Domain)
    private readonly domains: Repository<Domain>,
    @InjectRepository(Deployment)
    private readonly deployments: Repository<Deployment>,
    @InjectRepository(Server)
    private readonly servers: Repository<Server>,
    private readonly proxy: ProxyService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  // ---- target ------------------------------------------------------------

  /**
   * Where a check goes, derived from the application and never from user
   * input: its first domain (the public path through the proxy — unless the
   * monitor is set to `useInternal`), else a published host port, else the
   * container's name on the `aoox` network (only reachable when this API
   * runs in that network, i.e. the dist stack). Only the path is the user's.
   */
  async resolveTarget(
    app: Application,
    monitor: Pick<HttpMonitor, 'path' | 'useInternal'>,
    domains?: Domain[],
  ): Promise<{ target: MonitorTarget | null; error: string | null }> {
    const remote = app.serverId ? await this.serverOf(app.serverId) : null;
    if (app.serverId && !remote)
      return {
        target: null,
        error: "The application's server no longer exists",
      };
    let base: string | null = null;
    let source: TargetSource | null = null;

    const first = monitor.useInternal
      ? undefined
      : (domains ?? (await this.domainsOf([app.id])).get(app.id) ?? [])[0];
    if (first) {
      const https = first.https;
      const settings = remote
        ? proxySettingsOf(remote)
        : this.proxy.localSettings;
      const port = https ? settings.httpsPort : settings.httpPort;
      const standard = port === (https ? 443 : 80);
      base = `${https ? 'https' : 'http'}://${first.host}${standard ? '' : `:${port}`}`;
      source = 'domain';
    } else if (remote) {
      if (app.hostPort) {
        base = `http://${remote.host}:${app.hostPort}`;
        source = 'hostPort';
      }
    } else if (inDocker() && app.deployMode === 'container') {
      base = `http://aoox-app-${app.appName}:${app.containerPort}`;
      source = 'container';
    } else if (app.hostPort) {
      base = `http://127.0.0.1:${app.hostPort}`;
      source = 'hostPort';
    }
    if (!base || !source)
      return {
        target: null,
        error:
          'No reachable address: add a domain or a host port to the application',
      };

    const pathError = validateMonitorPath(monitor.path);
    if (pathError) return { target: null, error: pathError };
    const url = new URL(monitor.path, base);
    // Belt and braces: the path must not have moved the request off the target host.
    if (url.origin !== new URL(base).origin)
      return { target: null, error: 'path leaves the application host' };
    return { target: { url: url.toString(), source }, error: null };
  }

  private async serverOf(id: string): Promise<Server | null> {
    return this.servers.findOne({ where: { id } });
  }

  private async domainsOf(appIds: string[]): Promise<Map<string, Domain[]>> {
    const map = new Map<string, Domain[]>();
    if (appIds.length === 0) return map;
    const rows = await this.domains.find({
      where: { applicationId: In(appIds) },
      order: { createdAt: 'ASC' },
    });
    for (const d of rows) {
      const list = map.get(d.applicationId) ?? [];
      list.push(d);
      map.set(d.applicationId, list);
    }
    return map;
  }

  // ---- config ------------------------------------------------------------

  async findByApp(applicationId: string): Promise<HttpMonitor | null> {
    return this.monitors.findOne({ where: { applicationId } });
  }

  /** Creates or updates the monitor of an application. Turning it off clears the live state. */
  async saveConfig(
    app: Application,
    input: Partial<MonitorView['config']>,
  ): Promise<HttpMonitor> {
    const existing = await this.findByApp(app.id);
    const monitor =
      existing ??
      this.monitors.create({ applicationId: app.id, ...DEFAULT_CONFIG });
    const wasEnabled = monitor.enabled;
    Object.assign(monitor, input);
    if (!monitor.enabled && (wasEnabled || existing)) {
      await this.resetState(monitor);
    } else if (monitor.enabled && !wasEnabled) {
      monitor.status = 'unknown';
      monitor.consecutiveFailures = 0;
      monitor.statusSince = null;
      monitor.lastCheckedAt = null; // first check on the next tick
    }
    return this.monitors.save(monitor);
  }

  /** Back to "not checked", closing an open incident (no recovery alert: it is not a recovery). */
  private async resetState(monitor: HttpMonitor): Promise<void> {
    monitor.status = 'unknown';
    monitor.consecutiveFailures = 0;
    monitor.statusSince = null;
    if (monitor.id) {
      await this.incidents.update(
        { monitorId: monitor.id, endedAt: IsNull() },
        { endedAt: new Date() },
      );
    }
  }

  // ---- export / import ---------------------------------------------------

  /** The config of an application's monitor for a project export (no state, no history). */
  async exportConfig(
    applicationId: string,
  ): Promise<MonitorView['config'] | null> {
    const m = await this.findByApp(applicationId);
    if (!m) return null;
    return {
      enabled: m.enabled,
      path: m.path,
      intervalMinutes: m.intervalMinutes,
      timeoutSeconds: m.timeoutSeconds,
      expectedCodes: m.expectedCodes,
      failureThreshold: m.failureThreshold,
      useInternal: m.useInternal,
    };
  }

  /**
   * Creates the monitor of an imported application. The file is not trusted:
   * every value is checked like an API request, and a bad one falls back to
   * the default with a warning instead of failing the whole import.
   */
  async importConfig(
    app: Application,
    raw: Partial<MonitorView['config']>,
    where: string,
    warnings: string[],
  ): Promise<void> {
    const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
      typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
        ? v
        : dflt;
    let path = DEFAULT_CONFIG.path;
    if (raw.path !== undefined) {
      const error = validateMonitorPath(raw.path);
      if (error) warnings.push(`${where}: monitor path ignored (${error})`);
      else path = raw.path;
    }
    let expectedCodes = DEFAULT_CONFIG.expectedCodes;
    if (raw.expectedCodes !== undefined) {
      if (parseExpectedCodes(raw.expectedCodes))
        expectedCodes = raw.expectedCodes;
      else warnings.push(`${where}: monitor expectedCodes ignored`);
    }
    await this.saveConfig(app, {
      enabled: raw.enabled === true,
      path,
      intervalMinutes: clamp(
        raw.intervalMinutes,
        1,
        60,
        DEFAULT_CONFIG.intervalMinutes,
      ),
      timeoutSeconds: clamp(
        raw.timeoutSeconds,
        1,
        30,
        DEFAULT_CONFIG.timeoutSeconds,
      ),
      expectedCodes,
      failureThreshold: clamp(
        raw.failureThreshold,
        1,
        10,
        DEFAULT_CONFIG.failureThreshold,
      ),
      useInternal: raw.useInternal === true,
    });
  }

  // ---- scheduling --------------------------------------------------------

  /**
   * Once a minute: runs the monitors that are due, for applications that are
   * `running`, have no deployment in progress and did not finish one in the
   * last minute. A stopped application is not "down": its monitor is just
   * reset. Checks run a few at a time and a monitor never overlaps itself.
   */
  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.runDue(new Date());
    } catch (err) {
      this.logger.warn(`Monitor tick failed: ${String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  async runDue(now: Date): Promise<number> {
    const rows = await this.monitors.find({
      where: { enabled: true },
      relations: { application: true },
    });
    if (rows.length === 0) return 0;
    const appIds = rows.map((m) => m.applicationId);
    const [busy, recent, domains] = await Promise.all([
      this.deployments.find({
        where: {
          applicationId: In(appIds),
          status: In(ACTIVE_DEPLOYMENT_STATUSES),
        },
        select: { id: true, applicationId: true },
      }),
      this.deployments.find({
        where: {
          applicationId: In(appIds),
          finishedAt: MoreThan(new Date(now.getTime() - POST_DEPLOY_GRACE_MS)),
        },
        select: { id: true, applicationId: true },
      }),
      this.domainsOf(appIds),
    ]);
    const deploying = new Set([...busy, ...recent].map((d) => d.applicationId));
    const queue: Array<{ monitor: HttpMonitor; domains: Domain[] }> = [];
    for (const m of rows) {
      const app = m.application;
      if (app.status !== 'running') {
        if (m.status !== 'unknown') {
          await this.resetState(m);
          await this.monitors.save(m);
        }
        continue;
      }
      if (deploying.has(app.id)) {
        // A streak that straddles a deploy means nothing; an outage in progress stays as it is.
        if (m.status !== 'down' && m.consecutiveFailures > 0) {
          m.consecutiveFailures = 0;
          await this.monitors.save(m);
        }
        continue;
      }
      if (
        this.inFlight.has(m.id) ||
        !isDue(m.lastCheckedAt, m.intervalMinutes, now)
      )
        continue;
      queue.push({ monitor: m, domains: domains.get(app.id) ?? [] });
    }
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        await this.check(
          job.monitor,
          job.monitor.application,
          job.domains,
          now, // the tick's time: a 1-minute interval must not drift past the next tick
        ).catch((err) =>
          this.logger.warn(
            `Check of ${job.monitor.application.name} failed: ${String(err)}`,
          ),
        );
      }
    };
    const total = queue.length;
    await Promise.all(
      Array.from({ length: Math.min(CHECK_CONCURRENCY, total) }, worker),
    );
    return total;
  }

  /** One check: probe, store the result, advance the state, alert on transitions. */
  async check(
    monitor: HttpMonitor,
    app: Application,
    domains?: Domain[],
    now = new Date(),
    doProbe: (url: URL, timeoutSeconds: number) => Promise<ProbeResult> = probe,
  ): Promise<{
    ok: boolean;
    result: ProbeResult | null;
    error: string | null;
  }> {
    if (this.inFlight.has(monitor.id))
      return { ok: true, result: null, error: 'already running' };
    this.inFlight.add(monitor.id);
    try {
      const { target, error: targetError } = await this.resolveTarget(
        app,
        monitor,
        domains,
      );
      if (!target) {
        // A configuration problem, not an outage: show it, never alert.
        monitor.lastCheckedAt = now;
        monitor.lastError = targetError;
        monitor.lastTarget = null;
        monitor.lastStatusCode = null;
        monitor.lastLatencyMs = null;
        await this.monitors.save(monitor);
        return { ok: false, result: null, error: targetError };
      }
      const result = await doProbe(new URL(target.url), monitor.timeoutSeconds);
      const ok =
        result.statusCode !== null &&
        statusIsHealthy(result.statusCode, monitor.expectedCodes);
      const error = ok
        ? null
        : (result.error ?? `HTTP ${result.statusCode}`).slice(0, 200);
      await this.checks.insert({
        monitorId: monitor.id,
        at: now,
        ok,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
        error,
      });

      const prev = monitor.status;
      const t = nextState(monitor, ok, monitor.failureThreshold);
      monitor.status = t.status;
      monitor.consecutiveFailures = t.consecutiveFailures;
      if (t.status !== prev) monitor.statusSince = now;
      monitor.lastCheckedAt = now;
      monitor.lastStatusCode = result.statusCode;
      monitor.lastLatencyMs = result.latencyMs;
      monitor.lastError = error;
      monitor.lastTarget = target.url.slice(0, 300);

      const message = await this.transition(
        monitor,
        app,
        t.event,
        target,
        error,
        now,
      );
      await this.monitors.save(monitor);
      if (message) await this.send(message);
      return { ok, result, error };
    } finally {
      this.inFlight.delete(monitor.id);
    }
  }

  /** Incident bookkeeping + the message to send (if any) for this check. */
  private async transition(
    monitor: HttpMonitor,
    app: Application,
    event: 'down' | 'recovered' | null,
    target: MonitorTarget,
    error: string | null,
    now: Date,
  ): Promise<NotificationMessage | null> {
    if (event === 'down') {
      // Dated from the first failed check of the streak.
      const streak = await this.checks.find({
        where: { monitorId: monitor.id },
        order: { at: 'DESC' },
        take: monitor.consecutiveFailures,
        select: { at: true },
      });
      const startedAt = streak.at(-1)?.at ?? now;
      await this.incidents.insert({
        monitorId: monitor.id,
        startedAt,
        reason: error,
        failedChecks: monitor.consecutiveFailures,
      });
      monitor.statusSince = startedAt;
      monitor.lastAlertAt = now;
      return this.message(app, monitor, target, 'down', error, startedAt, now);
    }
    if (event === 'recovered') {
      const open = await this.incidents.findOne({
        where: { monitorId: monitor.id, endedAt: IsNull() },
        order: { startedAt: 'DESC' },
      });
      const startedAt = open?.startedAt ?? null;
      if (open) await this.incidents.update(open.id, { endedAt: now });
      monitor.lastAlertAt = null;
      monitor.statusSince = now;
      return this.message(
        app,
        monitor,
        target,
        'recovered',
        null,
        startedAt,
        now,
      );
    }
    if (monitor.status === 'down' && shouldRealert(monitor.lastAlertAt, now)) {
      monitor.lastAlertAt = now;
      return this.message(
        app,
        monitor,
        target,
        'still-down',
        error,
        monitor.statusSince,
        now,
      );
    }
    return null;
  }

  private async message(
    app: Application,
    monitor: HttpMonitor,
    target: MonitorTarget,
    kind: 'down' | 'recovered' | 'still-down',
    error: string | null,
    since: Date | null,
    now: Date,
  ): Promise<NotificationMessage> {
    const project = await this.apps.findOne({
      where: { id: app.id },
      relations: { project: true },
    });
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    const common = {
      url: origin ? `${origin}/applications/${app.id}` : undefined,
    };
    const data: Record<string, unknown> = {
      applicationId: app.id,
      application: app.name,
      project: project?.project?.name ?? null,
      target: target.url,
    };
    const fields: Array<[string, string]> = [
      ['Application', app.name],
      ...(project?.project?.name
        ? ([['Project', project.project.name]] as Array<[string, string]>)
        : []),
      ['Target', target.url],
    ];
    if (kind === 'recovered') {
      const downFor = since
        ? formatDownTime(now.getTime() - since.getTime())
        : 'unknown';
      fields.push(['Down for', downFor]);
      return {
        title: `HTTP check healthy again: ${app.name}`,
        level: 'success',
        fields,
        ...common,
        data: {
          ...data,
          event: 'http.recovered',
          downSeconds: since
            ? Math.round((now.getTime() - since.getTime()) / 1000)
            : null,
        },
      };
    }
    fields.push(['Result', error ?? 'failed']);
    fields.push([
      'Failed checks in a row',
      String(monitor.consecutiveFailures),
    ]);
    if (since) fields.push(['Since', since.toISOString()]);
    return {
      title: `${kind === 'still-down' ? 'HTTP check still failing' : 'HTTP check failing'}: ${app.name}`,
      level: 'failure',
      fields,
      ...common,
      data: {
        ...data,
        event: 'http.down',
        reminder: kind === 'still-down',
        error,
        statusCode: monitor.lastStatusCode,
        failedChecks: monitor.consecutiveFailures,
      },
    };
  }

  private async send(message: NotificationMessage): Promise<void> {
    await this.notifications
      .broadcast('httpDown', message)
      .catch((err) =>
        this.logger.warn(`httpDown broadcast failed: ${String(err)}`),
      );
  }

  // ---- read side ---------------------------------------------------------

  async view(app: Application): Promise<MonitorView> {
    const monitor = await this.findByApp(app.id);
    const config = monitor
      ? {
          enabled: monitor.enabled,
          path: monitor.path,
          intervalMinutes: monitor.intervalMinutes,
          timeoutSeconds: monitor.timeoutSeconds,
          expectedCodes: monitor.expectedCodes,
          failureThreshold: monitor.failureThreshold,
          useInternal: monitor.useInternal,
        }
      : { ...DEFAULT_CONFIG };
    const { target, error } = await this.resolveTarget(app, config);
    const empty: MonitorView = {
      config,
      target,
      targetError: error,
      status: {
        state: monitor?.status ?? 'unknown',
        since: monitor?.statusSince ?? null,
        lastCheckedAt: monitor?.lastCheckedAt ?? null,
        lastStatusCode: monitor?.lastStatusCode ?? null,
        lastLatencyMs: monitor?.lastLatencyMs ?? null,
        lastError: monitor?.lastError ?? null,
        consecutiveFailures: monitor?.consecutiveFailures ?? 0,
      },
      stats: {
        uptime24h: null,
        uptime7d: null,
        checks24h: 0,
        avgLatencyMs24h: null,
        p95LatencyMs24h: null,
      },
      series: [],
      incidents: [],
    };
    if (!monitor) return empty;

    const [day, week, series, incidents] = await Promise.all([
      this.stats(monitor.id, 24),
      this.stats(monitor.id, 24 * 7),
      this.series(monitor.id),
      this.incidents.find({
        where: { monitorId: monitor.id },
        order: { startedAt: 'DESC' },
        take: 10,
      }),
    ]);
    const now = Date.now();
    return {
      ...empty,
      stats: {
        uptime24h: day.uptime,
        uptime7d: week.uptime,
        checks24h: day.total,
        avgLatencyMs24h: day.avg,
        p95LatencyMs24h: day.p95,
      },
      series,
      incidents: incidents.map((i) => ({
        id: i.id,
        startedAt: i.startedAt,
        endedAt: i.endedAt,
        durationSeconds: Math.round(
          ((i.endedAt?.getTime() ?? now) - i.startedAt.getTime()) / 1000,
        ),
        reason: i.reason,
        failedChecks: i.failedChecks,
      })),
    };
  }

  private async stats(
    monitorId: string,
    hours: number,
  ): Promise<{
    total: number;
    uptime: number | null;
    avg: number | null;
    p95: number | null;
  }> {
    const rows = await this.checks.query<
      Array<{
        total: string;
        ok_count: string;
        avg: string | null;
        p95: string | null;
      }>
    >(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE ok) AS ok_count,
              round(avg(latency_ms) FILTER (WHERE ok)) AS avg,
              round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok)) AS p95
         FROM http_checks
        WHERE monitor_id = $1 AND at >= now() - ($2 || ' hours')::interval`,
      [monitorId, String(hours)],
    );
    const r = rows[0];
    const total = Number(r?.total ?? 0);
    return {
      total,
      uptime:
        total === 0
          ? null
          : Math.round((Number(r.ok_count) / total) * 1000) / 10,
      avg: r?.avg == null ? null : Number(r.avg),
      p95: r?.p95 == null ? null : Number(r.p95),
    };
  }

  private async series(monitorId: string): Promise<MonitorView['series']> {
    const rows = await this.checks.query<
      Array<{
        t: Date;
        latency: string | null;
        checks: string;
        failures: string;
      }>
    >(
      `SELECT to_timestamp(floor(extract(epoch FROM at) / 720) * 720) AS t,
              round(avg(latency_ms) FILTER (WHERE ok)) AS latency,
              count(*) AS checks,
              count(*) FILTER (WHERE NOT ok) AS failures
         FROM http_checks
        WHERE monitor_id = $1 AND at >= now() - interval '24 hours'
        GROUP BY 1 ORDER BY 1`,
      [monitorId],
    );
    return rows.map((r) => ({
      at: new Date(r.t).toISOString(),
      latencyMs: r.latency == null ? null : Number(r.latency),
      checks: Number(r.checks),
      failures: Number(r.failures),
    }));
  }

  // ---- retention ---------------------------------------------------------

  /** Drops old check rows (age and per-monitor count) and old incidents. */
  @Cron('17 * * * *')
  async prune(): Promise<void> {
    try {
      await this.checks.query(
        `DELETE FROM http_checks WHERE at < now() - ($1 || ' days')::interval`,
        [String(CHECK_RETENTION_DAYS)],
      );
      await this.checks.query(
        `DELETE FROM http_checks c USING (
           SELECT id FROM (
             SELECT id, row_number() OVER (PARTITION BY monitor_id ORDER BY at DESC) AS rn
               FROM http_checks
           ) t WHERE t.rn > $1
         ) d WHERE c.id = d.id`,
        [CHECK_MAX_ROWS],
      );
      await this.incidents.query(
        `DELETE FROM http_incidents i USING (
           SELECT id FROM (
             SELECT id, row_number() OVER (PARTITION BY monitor_id ORDER BY started_at DESC) AS rn
               FROM http_incidents
           ) t WHERE t.rn > $1
         ) d WHERE i.id = d.id`,
        [INCIDENTS_KEEP],
      );
    } catch (err) {
      this.logger.warn(`Monitor prune failed: ${String(err)}`);
    }
  }
}
