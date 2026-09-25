import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  METRIC_RANGES,
  type MetricRange,
} from '../../monitoring/metric-retention.service';
import type { ContainerMetrics } from '../../monitoring/container-metrics';

export class ApplicationMetricsParamsDto {
  @IsUUID()
  id: string;
}

export class MetricsQueryDto {
  /** `1h` (live, from memory) or a stored range; default `1h`. */
  @IsOptional()
  @IsIn(METRIC_RANGES)
  range?: MetricRange;
}

/** `null` while the container is missing/stopped or not yet sampled. */
export class ApplicationMetricsResponseDto {
  current: ContainerMetrics | null;
  history: ContainerMetrics[];
  /** Service mode: number of local tasks summed into the figures (1 for a container). */
  tasks: number;
  /** Which range the history covers; `1h` is live, longer ones come from stored rollups. */
  range: MetricRange;
}
