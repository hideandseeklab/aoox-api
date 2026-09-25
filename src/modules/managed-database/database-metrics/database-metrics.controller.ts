import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DockerService } from '../../docker/docker.service';
import { MonitoringService } from '../../monitoring/monitoring.service';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';
import { MetricsQueryDto } from '../../application/application-metrics/application-metrics.dto';
import { MetricRetentionService } from '../../monitoring/metric-retention.service';
import {
  DatabaseMetricsParamsDto,
  DatabaseMetricsResponseDto,
} from './database-metrics.dto';

/** Same shape as the application metrics endpoint, for a managed database. */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DatabaseMetricsController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
    private readonly monitoring: MonitoringService,
    private readonly retention: MetricRetentionService,
  ) {}

  @Get(':id/metrics')
  async metrics(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseMetricsParamsDto,
    @Query() query: MetricsQueryDto,
  ): Promise<DatabaseMetricsResponseDto> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const range = query.range ?? '1h';
    if (range !== '1h') {
      const history = await this.retention.history('database', db.id, range);
      return { current: history.at(-1) ?? null, history, range };
    }
    const c = await this.docker
      .findContainerByName(containerNameForDb(db))
      .catch(() => null);
    const m = c ? this.monitoring.metricsFor(c.Id) : null;
    return { current: m?.current ?? null, history: m?.history ?? [], range };
  }
}
