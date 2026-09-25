import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { DockerService } from '../docker/docker.service';
import { ContainerMetrics } from './container-metrics';
import {
  MetricOwnerKind,
  MetricResolution,
  MetricSample,
} from './metric-sample.entity';
import { MonitoringService } from './monitoring.service';

/** Ranges the API offers; `1h` is served from memory, the rest from rows. */
export const METRIC_RANGES = ['1h', '24h', '7d', '30d'] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

const RANGE_MS: Record<MetricRange, number> = {
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

/** Minute rows cover the 24 h chart; hour rows the longer ones. */
const MINUTE_KEEP_HOURS = 48;
const DEFAULT_HOUR_KEEP_DAYS = 30;

export interface MetricPoint {
  at: string;
  cpuPercent: number | null;
  memoryBytes: number;
  memoryLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}

/**
 * Persists what the in-memory sampler collects: every minute the 15-second
 * points of each application/database/compose stack (all its containers
 * summed, swarm tasks included) become one row; every hour those minutes
 * are averaged into an hour row; old rows are pruned. Restarting the API no
 * longer loses the history, and charts can go back further than an hour.
 */
@Injectable()
export class MetricRetentionService {
  private readonly logger = new Logger(MetricRetentionService.name);
  /** Timestamp of the last point already written, per container. */
  private readonly written = new Map<string, number>();

  constructor(
    @InjectRepository(MetricSample)
    private readonly repo: Repository<MetricSample>,
    private readonly monitoring: MonitoringService,
    private readonly docker: DockerService,
    private readonly config: ConfigService,
  ) {}

  private get hourKeepDays(): number {
    const n = Number(this.config.get<string>('METRICS_RETENTION_DAYS'));
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_HOUR_KEEP_DAYS;
  }

  /** Rolls the last minute of in-memory points into one row per owner. */
  @Cron('* * * * *')
  async rollupMinute(): Promise<void> {
    try {
      const owners = await this.ownersByContainer();
      if (owners.size === 0) return;
      const buckets = new Map<
        string,
        {
          kind: MetricOwnerKind;
          id: string;
          points: ContainerMetrics[];
          containers: Set<string>;
        }
      >();
      for (const {
        containerId,
        points,
      } of this.monitoring.sampledContainers()) {
        const owner = owners.get(containerId);
        if (!owner) continue;
        const since = this.written.get(containerId) ?? 0;
        const fresh = points.filter((p) => Date.parse(p.at) > since);
        if (fresh.length === 0) continue;
        this.written.set(containerId, Date.parse(fresh[fresh.length - 1].at));
        const key = `${owner.kind}:${owner.id}`;
        const bucket = buckets.get(key) ?? {
          kind: owner.kind,
          id: owner.id,
          points: [],
          containers: new Set<string>(),
        };
        bucket.points.push(...fresh);
        bucket.containers.add(containerId);
        buckets.set(key, bucket);
      }
      const at = floorTo(new Date(), 60_000);
      for (const b of buckets.values()) {
        await this.upsert({
          ownerKind: b.kind,
          ownerId: b.id,
          resolution: 'minute',
          at,
          containers: b.containers.size,
          ...averageBucket(b.points, b.containers.size),
        });
      }
      // Containers that disappeared should not keep a cursor forever.
      const live = new Set(owners.keys());
      for (const id of this.written.keys()) {
        if (!live.has(id)) this.written.delete(id);
      }
    } catch (err) {
      this.logger.debug(`Minute rollup skipped: ${String(err)}`);
    }
  }

  /** Averages the finished hour's minute rows into one hour row per owner. */
  @Cron('2 * * * *')
  async rollupHour(): Promise<void> {
    const end = floorTo(new Date(), 3_600_000);
    const start = new Date(end.getTime() - 3_600_000);
    const rows = await this.repo
      .createQueryBuilder('m')
      .select('m.owner_kind', 'ownerKind')
      .addSelect('m.owner_id', 'ownerId')
      .addSelect('AVG(m.cpu_percent)', 'cpuPercent')
      .addSelect('AVG(m.memory_bytes)', 'memoryBytes')
      .addSelect('MAX(m.memory_limit_bytes)', 'memoryLimitBytes')
      .addSelect('MAX(m.net_rx_bytes)', 'netRxBytes')
      .addSelect('MAX(m.net_tx_bytes)', 'netTxBytes')
      .addSelect('MAX(m.containers)', 'containers')
      .where('m.resolution = :r', { r: 'minute' })
      .andWhere('m.at >= :start AND m.at < :end', { start, end })
      .groupBy('m.owner_kind')
      .addGroupBy('m.owner_id')
      .getRawMany<{
        ownerKind: MetricOwnerKind;
        ownerId: string;
        cpuPercent: string | null;
        memoryBytes: string;
        memoryLimitBytes: string;
        netRxBytes: string;
        netTxBytes: string;
        containers: string;
      }>();
    for (const r of rows) {
      await this.upsert({
        ownerKind: r.ownerKind,
        ownerId: r.ownerId,
        resolution: 'hour',
        at: start,
        cpuPercent: r.cpuPercent === null ? null : Number(r.cpuPercent),
        memoryBytes: String(Math.round(Number(r.memoryBytes))),
        memoryLimitBytes: r.memoryLimitBytes,
        netRxBytes: r.netRxBytes,
        netTxBytes: r.netTxBytes,
        containers: Number(r.containers),
      });
    }
  }

  /** Drops minute rows older than 48 h and hour rows past the retention. */
  @Cron('7 3 * * *')
  async prune(): Promise<number> {
    const now = Date.now();
    const minutes = await this.repo.delete({
      resolution: 'minute',
      at: LessThan(new Date(now - MINUTE_KEEP_HOURS * 3_600_000)),
    });
    const hours = await this.repo.delete({
      resolution: 'hour',
      at: LessThan(new Date(now - this.hourKeepDays * 24 * 3_600_000)),
    });
    const removed = (minutes.affected ?? 0) + (hours.affected ?? 0);
    if (removed) this.logger.log(`Pruned ${removed} metric row(s)`);
    return removed;
  }

  /** Stored history of one owner for a range (empty for `1h`, which is live). */
  async history(
    ownerKind: MetricOwnerKind,
    ownerId: string,
    range: MetricRange,
  ): Promise<MetricPoint[]> {
    if (range === '1h') return [];
    const resolution: MetricResolution = range === '24h' ? 'minute' : 'hour';
    const rows = await this.repo.find({
      where: {
        ownerKind,
        ownerId,
        resolution,
        at: MoreThanOrEqual(new Date(Date.now() - RANGE_MS[range])),
      },
      order: { at: 'ASC' },
    });
    return rows.map((r) => ({
      at: r.at.toISOString(),
      cpuPercent: r.cpuPercent,
      memoryBytes: Number(r.memoryBytes),
      memoryLimitBytes: Number(r.memoryLimitBytes),
      netRxBytes: Number(r.netRxBytes),
      netTxBytes: Number(r.netTxBytes),
    }));
  }

  /** Deletes an owner's history (the owner row itself has no FK to these). */
  async forget(ownerKind: MetricOwnerKind, ownerId: string): Promise<void> {
    await this.repo.delete({ ownerKind, ownerId });
  }

  private async upsert(row: Partial<MetricSample>): Promise<void> {
    await this.repo.upsert(this.repo.create(row), {
      conflictPaths: ['ownerKind', 'ownerId', 'resolution', 'at'],
      skipUpdateIfNoValuesChanged: false,
    });
  }

  /**
   * containerId → owner, read from the `aoox.*` labels — no DB query, so
   * this never needs to import ComposeModule/ManagedDatabaseModule (which
   * would cycle back through ApplicationModule). Compose containers only
   * carry `aoox.compose` when `compose-runner.service.ts`'s override gave
   * them a domain, port, mount or resource limit; a bare service (none of
   * those) stays live-only, same as before this label existed.
   */
  private async ownersByContainer(): Promise<
    Map<string, { kind: MetricOwnerKind; id: string }>
  > {
    const containers = await this.docker.engine.listContainers({
      label: ['aoox.component'],
      status: ['running'],
    });
    const out = new Map<string, { kind: MetricOwnerKind; id: string }>();
    for (const c of containers) {
      const app = c.Labels?.['aoox.application'];
      const db = c.Labels?.['aoox.database'];
      const compose = c.Labels?.['aoox.compose'];
      if (app) out.set(c.Id, { kind: 'application', id: app });
      else if (db) out.set(c.Id, { kind: 'database', id: db });
      else if (compose) out.set(c.Id, { kind: 'compose', id: compose });
    }
    return out;
  }
}

/**
 * Averages the points of a bucket over time while keeping the sum across
 * containers: `points` holds every container's points, so dividing by the
 * points *per container* leaves a total that matches the live view.
 * Exported for the unit test.
 */
export function averageBucket(
  points: ContainerMetrics[],
  containers: number,
): Pick<
  MetricSample,
  | 'cpuPercent'
  | 'memoryBytes'
  | 'memoryLimitBytes'
  | 'netRxBytes'
  | 'netTxBytes'
> {
  const per = Math.max(1, Math.round(points.length / Math.max(1, containers)));
  const cpu = points.filter((p) => p.cpuPercent !== null);
  const mean = (pick: (p: ContainerMetrics) => number) =>
    Math.round(points.reduce((n, p) => n + pick(p), 0) / per);
  return {
    cpuPercent:
      cpu.length === 0
        ? null
        : Math.round(
            (cpu.reduce((n, p) => n + (p.cpuPercent ?? 0), 0) / per) * 100,
          ) / 100,
    memoryBytes: String(mean((p) => p.memoryBytes)),
    memoryLimitBytes: String(mean((p) => p.memoryLimitBytes)),
    netRxBytes: String(mean((p) => p.netRxBytes)),
    netTxBytes: String(mean((p) => p.netTxBytes)),
  };
}

function floorTo(date: Date, ms: number): Date {
  return new Date(Math.floor(date.getTime() / ms) * ms);
}
