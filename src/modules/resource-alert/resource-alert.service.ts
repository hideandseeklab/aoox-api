import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import {
  Deployment,
  type DeploymentStatus,
} from '../application/deployment.entity';
import { MetricSample } from '../monitoring/metric-sample.entity';
import { NotificationMessage } from '../notification/notification-sender';
import { NotificationService } from '../notification/notification.service';
import {
  evaluateBreach,
  MAX_DURATION_MINUTES,
  nextAlertState,
  type MinuteReading,
} from './alert-evaluation';
import {
  ResourceAlertRule,
  type AlertMetric,
  type AlertStatus,
} from './resource-alert-rule.entity';

export const ALERT_METRICS: AlertMetric[] = ['cpu', 'memory'];
export const DEFAULT_RULE = {
  enabled: false,
  thresholdPercent: 90,
  durationMinutes: 5,
} as const;

const ACTIVE_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  'queued',
  'building',
  'pushing',
  'starting',
];

export type AlertOwner =
  { kind: 'application'; id: string } | { kind: 'database'; id: string };

export interface RuleConfig {
  enabled: boolean;
  thresholdPercent: number;
  durationMinutes: number;
}

export interface RuleView extends RuleConfig {
  state: {
    status: AlertStatus;
    since: Date | null;
    /** Value of the last evaluation (percent), null when none yet. */
    lastValue: number | null;
    lastEvaluatedAt: Date | null;
    lastAlertAt: Date | null;
  };
}

export interface ResourceAlertsView {
  cpu: RuleView;
  memory: RuleView;
  /** The limits the percentages refer to (null = none set). */
  limits: { cpuMillicores: number | null; memoryMb: number | null };
}

export type ResourceAlertsConfig = Record<AlertMetric, RuleConfig>;

const ownerWhere = (o: AlertOwner) =>
  o.kind === 'application' ? { applicationId: o.id } : { databaseId: o.id };

/**
 * Optional CPU / memory threshold rules per application and managed
 * database. Evaluated once a minute from the stored minute rollups
 * (`metric_samples`, written by MetricRetentionService), so there are no
 * Docker calls here and remote-server applications work the same. The state
 * lives in the rule rows: an API restart neither re-alerts nor forgets a breach.
 */
@Injectable()
export class ResourceAlertService {
  private readonly logger = new Logger(ResourceAlertService.name);
  private ticking = false;

  constructor(
    @InjectRepository(ResourceAlertRule)
    private readonly rules: Repository<ResourceAlertRule>,
    @InjectRepository(MetricSample)
    private readonly samples: Repository<MetricSample>,
    @InjectRepository(Deployment)
    private readonly deployments: Repository<Deployment>,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  // ---- config / read side ------------------------------------------------

  async view(
    owner: AlertOwner,
    limits: ResourceAlertsView['limits'],
  ): Promise<ResourceAlertsView> {
    const rows = await this.rules.find({ where: ownerWhere(owner) });
    const rule = (metric: AlertMetric): RuleView => {
      const r = rows.find((x) => x.metric === metric);
      return r
        ? {
            enabled: r.enabled,
            thresholdPercent: r.thresholdPercent,
            durationMinutes: r.durationMinutes,
            state: {
              status: r.status,
              since: r.statusSince,
              lastValue: r.lastValue,
              lastEvaluatedAt: r.lastEvaluatedAt,
              lastAlertAt: r.lastAlertAt,
            },
          }
        : {
            ...DEFAULT_RULE,
            state: {
              status: 'ok',
              since: null,
              lastValue: null,
              lastEvaluatedAt: null,
              lastAlertAt: null,
            },
          };
    };
    return { cpu: rule('cpu'), memory: rule('memory'), limits };
  }

  /** Creates or updates one rule; a config change resets its state silently. */
  async saveRule(
    owner: AlertOwner,
    metric: AlertMetric,
    input: Partial<RuleConfig>,
  ): Promise<void> {
    if (metric === 'memory' && (input.thresholdPercent ?? 0) > 100)
      throw new BadRequestException(
        'The memory threshold cannot be above 100 percent',
      );
    const existing = await this.rules.findOne({
      where: { ...ownerWhere(owner), metric },
    });
    const next: RuleConfig = {
      enabled: input.enabled ?? existing?.enabled ?? DEFAULT_RULE.enabled,
      thresholdPercent:
        input.thresholdPercent ??
        existing?.thresholdPercent ??
        DEFAULT_RULE.thresholdPercent,
      durationMinutes:
        input.durationMinutes ??
        existing?.durationMinutes ??
        DEFAULT_RULE.durationMinutes,
    };
    if (existing) {
      const changed =
        existing.enabled !== next.enabled ||
        existing.thresholdPercent !== next.thresholdPercent ||
        existing.durationMinutes !== next.durationMinutes;
      Object.assign(existing, next);
      if (changed) this.resetState(existing);
      await this.rules.save(existing);
      return;
    }
    await this.rules.save(
      this.rules.create({ ...ownerWhere(owner), metric, ...next }),
    );
  }

  private resetState(r: ResourceAlertRule): void {
    r.status = 'ok';
    r.statusSince = null;
    r.lastAlertAt = null;
    r.lastValue = null;
    r.lastEvaluatedAt = null;
  }

  async exportConfig(owner: AlertOwner): Promise<ResourceAlertsConfig | null> {
    const rows = await this.rules.find({ where: ownerWhere(owner) });
    if (rows.length === 0) return null;
    const pick = (metric: AlertMetric): RuleConfig => {
      const r = rows.find((x) => x.metric === metric);
      return {
        enabled: r?.enabled ?? DEFAULT_RULE.enabled,
        thresholdPercent: r?.thresholdPercent ?? DEFAULT_RULE.thresholdPercent,
        durationMinutes: r?.durationMinutes ?? DEFAULT_RULE.durationMinutes,
      };
    };
    return { cpu: pick('cpu'), memory: pick('memory') };
  }

  /** The file is not trusted: bad values fall back to the defaults with a warning. */
  async importConfig(
    owner: AlertOwner,
    raw: Partial<Record<AlertMetric, Partial<RuleConfig>>>,
    where: string,
    warnings: string[],
  ): Promise<void> {
    const int = (
      v: unknown,
      lo: number,
      hi: number,
      dflt: number,
      label: string,
    ): number => {
      if (v === undefined) return dflt;
      if (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi)
        return v;
      warnings.push(`${where}: ${label} ignored`);
      return dflt;
    };
    for (const metric of ALERT_METRICS) {
      const r = raw?.[metric];
      if (!r || typeof r !== 'object') continue;
      await this.saveRule(owner, metric, {
        enabled: r.enabled === true,
        thresholdPercent: int(
          r.thresholdPercent,
          1,
          metric === 'memory' ? 100 : 1000,
          DEFAULT_RULE.thresholdPercent,
          `${metric} alert threshold`,
        ),
        durationMinutes: int(
          r.durationMinutes,
          1,
          MAX_DURATION_MINUTES,
          DEFAULT_RULE.durationMinutes,
          `${metric} alert duration`,
        ),
      });
    }
  }

  // ---- evaluation --------------------------------------------------------

  /** Second 30 of every minute, after the `:00` rollup has written the minute row. */
  @Cron('30 * * * * *')
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.evaluateAll(new Date());
    } catch (err) {
      this.logger.warn(`Resource alert tick failed: ${String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  async evaluateAll(now: Date): Promise<number> {
    const rows = await this.rules.find({
      where: { enabled: true },
      relations: {
        application: { project: true },
        database: { project: true },
      },
    });
    if (rows.length === 0) return 0;
    const ownerIds = [
      ...new Set(rows.map((r) => r.applicationId ?? r.databaseId!)),
    ];
    const appIds = [
      ...new Set(
        rows.filter((r) => r.applicationId).map((r) => r.applicationId!),
      ),
    ];
    const maxMinutes = Math.max(...rows.map((r) => r.durationMinutes));
    const [samples, busy, finished] = await Promise.all([
      this.samples.find({
        where: {
          resolution: 'minute',
          ownerId: In(ownerIds),
          at: MoreThan(new Date(now.getTime() - (maxMinutes + 1) * 60_000)),
        },
      }),
      appIds.length
        ? this.deployments.find({
            where: {
              applicationId: In(appIds),
              status: In(ACTIVE_DEPLOYMENT_STATUSES),
            },
            select: { id: true, applicationId: true },
          })
        : Promise.resolve([] as Deployment[]),
      appIds.length
        ? this.deployments
            .createQueryBuilder('d')
            .select('d.application_id', 'applicationId')
            .addSelect('MAX(d.finished_at)', 'finishedAt')
            .where('d.application_id IN (:...ids)', { ids: appIds })
            .groupBy('d.application_id')
            .getRawMany<{ applicationId: string; finishedAt: Date | null }>()
        : Promise.resolve(
            [] as Array<{ applicationId: string; finishedAt: Date | null }>,
          ),
    ]);
    const deploying = new Set(busy.map((d) => d.applicationId));
    const lastFinished = new Map(
      finished.map((f) => [
        f.applicationId,
        f.finishedAt ? new Date(f.finishedAt) : null,
      ]),
    );
    const byOwner = new Map<string, MinuteReading[]>();
    for (const s of samples) {
      const list = byOwner.get(s.ownerId) ?? [];
      list.push({
        at: s.at,
        cpuPercent: s.cpuPercent,
        memoryBytes: Number(s.memoryBytes),
        memoryLimitBytes: Number(s.memoryLimitBytes),
      });
      byOwner.set(s.ownerId, list);
    }
    let evaluated = 0;
    for (const rule of rows) {
      try {
        const owner = rule.application ?? rule.database;
        if (!owner) continue;
        const id = owner.id;
        if (owner.status !== 'running') {
          // A stopped owner is not "alerting": drop the state without a message.
          if (rule.status !== 'ok') {
            this.resetState(rule);
            await this.rules.save(rule);
          }
          continue;
        }
        if (rule.applicationId && deploying.has(id)) {
          if (rule.status === 'pending') {
            rule.status = 'ok';
            rule.statusSince = null;
            await this.rules.save(rule);
          }
          continue; // an alert in progress stays as it is
        }
        const ev = evaluateBreach(
          rule.metric,
          byOwner.get(id) ?? [],
          rule.thresholdPercent,
          rule.durationMinutes,
          now,
          rule.applicationId ? (lastFinished.get(id) ?? null) : null,
        );
        const since = rule.statusSince;
        const { state, action } = nextAlertState(
          {
            status: rule.status,
            statusSince: rule.statusSince,
            lastAlertAt: rule.lastAlertAt,
          },
          ev.breaching,
          now,
        );
        rule.status = state.status;
        rule.statusSince = state.statusSince;
        rule.lastAlertAt = state.lastAlertAt;
        rule.lastValue = ev.latestValue;
        rule.lastEvaluatedAt = now;
        await this.rules.save(rule);
        evaluated++;
        if (action)
          await this.send(
            this.message(
              rule,
              owner.name,
              owner.project?.name ?? null,
              action,
              ev.latestValue,
              since,
              now,
            ),
          );
      } catch (err) {
        this.logger.warn(`Alert rule ${rule.id} failed: ${String(err)}`);
      }
    }
    return evaluated;
  }

  private message(
    rule: ResourceAlertRule,
    name: string,
    project: string | null,
    action: 'alert' | 'reminder' | 'recovered',
    value: number | null,
    since: Date | null,
    now: Date,
  ): NotificationMessage {
    const kind = rule.applicationId ? 'application' : 'database';
    const origin = this.config.get<string>('WEB_ORIGIN')?.trim();
    const path = rule.applicationId
      ? `/applications/${rule.applicationId}`
      : `/databases/${rule.databaseId}`;
    const metricLabel = rule.metric === 'cpu' ? 'CPU' : 'Memory';
    const rounded = value === null ? null : Math.round(value * 10) / 10;
    const ids = rule.applicationId
      ? { applicationId: rule.applicationId }
      : { databaseId: rule.databaseId };
    const fields: Array<[string, string]> = [
      [kind === 'application' ? 'Application' : 'Database', name],
      ...(project ? ([['Project', project]] as Array<[string, string]>) : []),
      ['Metric', metricLabel],
    ];
    const common = { url: origin ? `${origin}${path}` : undefined };
    if (action === 'recovered') {
      const breachSeconds = since
        ? Math.round((now.getTime() - since.getTime()) / 1000)
        : null;
      return {
        title: `${metricLabel} back to normal: ${name}`,
        level: 'success',
        fields: [...fields, ['Threshold', `${rule.thresholdPercent}%`]],
        ...common,
        params: {
          variant: 'recovered',
          kind,
          name,
          project,
          metric: rule.metric,
          threshold: rule.thresholdPercent,
          breachSeconds,
        },
        data: {
          ...ids,
          event: 'resource.recovered',
          metric: rule.metric,
          thresholdPercent: rule.thresholdPercent,
          breachSeconds,
        },
      };
    }
    const reminder = action === 'reminder';
    return {
      title: `${metricLabel} ${reminder ? 'still high' : 'high'}: ${name}`,
      level: 'failure',
      fields: [
        ...fields,
        ['Value', rounded === null ? 'n/a' : `${rounded}%`],
        [
          'Rule',
          `above ${rule.thresholdPercent}% for ${rule.durationMinutes} min`,
        ],
      ],
      ...common,
      params: {
        variant: 'alert',
        kind,
        name,
        project,
        metric: rule.metric,
        value: rounded,
        threshold: rule.thresholdPercent,
        durationMinutes: rule.durationMinutes,
        reminder,
      },
      data: {
        ...ids,
        event: 'resource.alert',
        metric: rule.metric,
        value: rounded,
        thresholdPercent: rule.thresholdPercent,
        durationMinutes: rule.durationMinutes,
        reminder,
      },
    };
  }

  private async send(message: NotificationMessage): Promise<void> {
    await this.notifications
      .broadcast('resourceAlert', message)
      .catch((err) =>
        this.logger.warn(`resourceAlert broadcast failed: ${String(err)}`),
      );
  }
}
