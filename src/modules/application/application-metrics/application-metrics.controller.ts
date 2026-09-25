import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { RemoteDockerService } from '../../server/remote-docker.service';
import { aggregateMetrics } from '../../monitoring/container-metrics';
import {
  MonitoringService,
  SAMPLE_INTERVAL_MS,
} from '../../monitoring/monitoring.service';
import { ApplicationService, containerNameFor } from '../application.service';
import { SwarmDeployService } from '../swarm-deploy.service';
import { MetricRetentionService } from '../../monitoring/metric-retention.service';
import {
  ApplicationMetricsParamsDto,
  ApplicationMetricsResponseDto,
  MetricsQueryDto,
} from './application-metrics.dto';

/** Point-in-time + recent history from the background sampler (never blocks on Docker stats). */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationMetricsController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly remote: RemoteDockerService,
    private readonly monitoring: MonitoringService,
    private readonly swarmDeploy: SwarmDeployService,
    private readonly retention: MetricRetentionService,
  ) {}

  @Get(':id/metrics')
  async metrics(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationMetricsParamsDto,
    @Query() query: MetricsQueryDto,
  ): Promise<ApplicationMetricsResponseDto> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const range = query.range ?? '1h';
    if (range !== '1h') {
      // Stored rollups: one series per application, tasks already summed.
      const history = await this.retention.history(
        'application',
        app.id,
        range,
      );
      return {
        current: history.at(-1) ?? null,
        history,
        tasks: 1,
        range,
      };
    }
    if (app.deployMode === 'service') {
      // Service mode: every running task on this node, summed.
      const ids = await this.swarmDeploy.taskContainers(app).catch(() => []);
      const series = ids
        .map((id) => this.monitoring.metricsFor(id))
        .filter((m): m is NonNullable<typeof m> => m !== null);
      const m = aggregateMetrics(series, SAMPLE_INTERVAL_MS);
      return {
        current: m?.current ?? null,
        history: m?.history ?? [],
        tasks: series.length,
        range,
      };
    }
    const docker = await this.remote.forServer(app.serverId);
    const c = await docker
      .findContainerByName(containerNameFor(app))
      .catch(() => null);
    const m = c ? this.monitoring.metricsFor(c.Id) : null;
    return {
      current: m?.current ?? null,
      history: m?.history ?? [],
      tasks: 1,
      range,
    };
  }
}
