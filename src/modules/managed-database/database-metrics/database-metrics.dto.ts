import { IsUUID } from 'class-validator';
import type { ContainerMetrics } from '../../monitoring/container-metrics';
import type { MetricRange } from '../../monitoring/metric-retention.service';

export class DatabaseMetricsParamsDto {
  @IsUUID()
  id: string;
}

/** `null` while the container is missing/stopped or not yet sampled. */
export class DatabaseMetricsResponseDto {
  current: ContainerMetrics | null;
  history: ContainerMetrics[];
  range: MetricRange;
}
