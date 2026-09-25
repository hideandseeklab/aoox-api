import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import {
  aggregateMetrics,
  ContainerMetrics,
} from '../../monitoring/container-metrics';
import {
  METRIC_RANGES,
  MetricRetentionService,
} from '../../monitoring/metric-retention.service';
import type {
  MetricPoint,
  MetricRange,
} from '../../monitoring/metric-retention.service';
import {
  MonitoringService,
  SAMPLE_INTERVAL_MS,
} from '../../monitoring/monitoring.service';
import { ComposeAppParamsDto } from '../compose-app.dto';
import { ComposeService } from '../compose.service';

export class ComposeMetricsQueryDto {
  /** `1h` (live, per service) or a stored range; default `1h`. */
  @IsOptional()
  @IsIn(METRIC_RANGES)
  range?: MetricRange;
}

/** One entry per stack container; only populated for `range: '1h'` (live). */
export interface ComposeServiceMetricsDto {
  containerId: string;
  name: string;
  service: string;
  current: ContainerMetrics | null;
  history: ContainerMetrics[];
}

export interface ComposeMetricsResponseDto {
  /** Per service, live only — empty for a stored range (no per-service history kept). */
  services: ComposeServiceMetricsDto[];
  /** The whole stack's containers summed: latest reading for `1h`, last stored point otherwise. */
  total: { cpuPercent: number; memoryBytes: number; containers: number };
  /** Same figures as `total`, shaped like `MetricsPanel` (application/database) expects. */
  current: MetricPoint | null;
  /** The stack's combined series (all services summed) for the requested range. */
  history: MetricPoint[];
  range: MetricRange;
}

/**
 * Per-service metrics of a stack. `1h` reads the background sampler (which
 * also samples compose containers, recognised by their project name) and
 * sums it into `history` via the same `aggregateMetrics` swarm tasks use.
 * `24h`/`7d`/`30d` read the stored rollup instead — but only for services
 * `compose-runner.service.ts`'s override gave the `aoox.compose` label
 * (a domain, port, mount or resource limit configured on them); a stack
 * with none of those set has no stored history yet, same as before.
 */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class ComposeMetricsController {
  constructor(
    private readonly compose: ComposeService,
    private readonly monitoring: MonitoringService,
    private readonly retention: MetricRetentionService,
  ) {}

  @Get(':id/metrics')
  async metrics(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
    @Query() query: ComposeMetricsQueryDto,
  ): Promise<ComposeMetricsResponseDto> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    const range = query.range ?? '1h';

    if (range !== '1h') {
      const history = await this.retention.history('compose', app.id, range);
      const last = history.at(-1) ?? null;
      return {
        services: [],
        total: {
          cpuPercent: last?.cpuPercent ?? 0,
          memoryBytes: last?.memoryBytes ?? 0,
          containers: 0,
        },
        current: last,
        history,
        range,
      };
    }

    const containers = await this.compose.containers(app);
    const services = containers.map((c) => {
      const m = this.monitoring.metricsFor(c.id);
      return {
        containerId: c.id,
        name: c.name,
        service: c.service,
        current: m?.current ?? null,
        history: m?.history ?? [],
      };
    });
    const total = services.reduce(
      (acc, s) => ({
        cpuPercent:
          Math.round((acc.cpuPercent + (s.current?.cpuPercent ?? 0)) * 100) /
          100,
        memoryBytes: acc.memoryBytes + (s.current?.memoryBytes ?? 0),
        containers: acc.containers + (s.current ? 1 : 0),
      }),
      { cpuPercent: 0, memoryBytes: 0, containers: 0 },
    );
    const combined = aggregateMetrics(
      services
        .filter(
          (s): s is typeof s & { current: ContainerMetrics } =>
            s.current !== null,
        )
        .map((s) => ({ current: s.current, history: s.history })),
      SAMPLE_INTERVAL_MS,
    );
    return {
      services,
      total,
      current: combined?.current ?? null,
      history: combined?.history ?? [],
      range,
    };
  }
}
