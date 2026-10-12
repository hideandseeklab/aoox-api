import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Application } from '../application/application.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';

export type AlertMetric = 'cpu' | 'memory';
/** `pending` = over the threshold but not yet for the whole duration. */
export type AlertStatus = 'ok' | 'pending' | 'alerting';

/**
 * One threshold rule on one metric of one application or managed database
 * (exactly one of `application_id` / `database_id` is set). The row also
 * carries the live state, so an API restart neither forgets a breach that is
 * in progress nor announces it a second time.
 */
@Entity({ name: 'resource_alert_rules' })
@Check(
  'CHK_resource_alert_rules_owner',
  '("application_id" IS NULL) <> ("database_id" IS NULL)',
)
@Index(
  'UQ_resource_alert_rules_application_metric',
  ['applicationId', 'metric'],
  {
    unique: true,
    where: '"application_id" IS NOT NULL',
  },
)
@Index('UQ_resource_alert_rules_database_metric', ['databaseId', 'metric'], {
  unique: true,
  where: '"database_id" IS NOT NULL',
})
export class ResourceAlertRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId: string | null;

  @ManyToOne(() => Application, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'application_id',
    foreignKeyConstraintName: 'FK_resource_alert_rules_application',
  })
  application: Application | null;

  @Column({ name: 'database_id', type: 'uuid', nullable: true })
  databaseId: string | null;

  @ManyToOne(() => ManagedDatabase, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'database_id',
    foreignKeyConstraintName: 'FK_resource_alert_rules_database',
  })
  database: ManagedDatabase | null;

  @Column({ type: 'varchar', length: 16 })
  metric: AlertMetric;

  @Column({ default: false })
  enabled: boolean;

  /** Alert when the value stays above this percentage. */
  @Column({ name: 'threshold_percent', type: 'int', default: 90 })
  thresholdPercent: number;

  /** ...for this many minutes in a row. */
  @Column({ name: 'duration_minutes', type: 'int', default: 5 })
  durationMinutes: number;

  // ---- live state (written by ResourceAlertService) ----

  @Column({ type: 'varchar', length: 16, default: 'ok' })
  status: AlertStatus;

  @Column({ name: 'status_since', type: 'timestamptz', nullable: true })
  statusSince: Date | null;

  @Column({ name: 'last_value', type: 'double precision', nullable: true })
  lastValue: number | null;

  @Column({ name: 'last_evaluated_at', type: 'timestamptz', nullable: true })
  lastEvaluatedAt: Date | null;

  @Column({ name: 'last_alert_at', type: 'timestamptz', nullable: true })
  lastAlertAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
