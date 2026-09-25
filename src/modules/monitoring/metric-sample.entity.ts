import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** What the sample belongs to; `aoox.application`/`.database`/`.compose` labels of the container. */
export type MetricOwnerKind = 'application' | 'database' | 'compose';
/** `minute` rows are the raw rollup, `hour` the downsample kept for long ranges. */
export type MetricResolution = 'minute' | 'hour';

/**
 * Rolled-up metrics of one application/database over one bucket. The
 * sampler keeps 15-second points in memory (live view); these rows are what
 * survives a restart and feeds the 24 h / 7 d / 30 d charts. Several
 * containers of the same owner (swarm tasks) are summed into one row.
 */
@Entity({ name: 'metric_samples' })
@Index(['ownerKind', 'ownerId', 'resolution', 'at'], { unique: true })
export class MetricSample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_kind', type: 'varchar' })
  ownerKind: MetricOwnerKind;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', default: 'minute' })
  resolution: MetricResolution;

  /** Start of the bucket (minute or hour, UTC). */
  @Column({ type: 'timestamptz' })
  at: Date;

  /** Average over the bucket; null when no container reported a CPU delta. */
  @Column({ name: 'cpu_percent', type: 'double precision', nullable: true })
  cpuPercent: number | null;

  @Column({ name: 'memory_bytes', type: 'bigint' })
  memoryBytes: string;

  @Column({ name: 'memory_limit_bytes', type: 'bigint' })
  memoryLimitBytes: string;

  @Column({ name: 'net_rx_bytes', type: 'bigint' })
  netRxBytes: string;

  @Column({ name: 'net_tx_bytes', type: 'bigint' })
  netTxBytes: string;

  /** Containers (tasks) summed into this row. */
  @Column({ type: 'integer', default: 1 })
  containers: number;
}
