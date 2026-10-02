import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Application } from '../application/application.entity';

export type HttpMonitorStatus = 'unknown' | 'up' | 'down';

/**
 * Optional HTTP check of one application (at most one per application). The
 * host is never stored: it is derived from the application itself when a
 * check runs (see HttpMonitorService.resolveTarget), so the only thing a user
 * controls in the request is the path.
 *
 * The row also carries the live state (`status`, `consecutive_failures`,
 * `status_since`, `last_alert_at`), so an API restart neither forgets an
 * outage that is in progress nor announces a healthy app as "down".
 */
@Entity({ name: 'http_monitors' })
export class HttpMonitor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @OneToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ default: false })
  enabled: boolean;

  /** Path (+ query) requested on the target; starts with `/`. */
  @Column({ type: 'varchar', length: 200, default: '/' })
  path: string;

  @Column({ name: 'interval_minutes', type: 'int', default: 5 })
  intervalMinutes: number;

  @Column({ name: 'timeout_seconds', type: 'int', default: 10 })
  timeoutSeconds: number;

  /** Healthy status codes: comma list of codes or ranges, e.g. `200-399` or `200,204`. */
  @Column({
    name: 'expected_codes',
    type: 'varchar',
    length: 80,
    default: '200-399',
  })
  expectedCodes: string;

  /** Failed checks in a row before the application counts as down (and alerts). */
  @Column({ name: 'failure_threshold', type: 'int', default: 2 })
  failureThreshold: number;

  /** Skip the public domain and probe through the internal address (host port / container name). */
  @Column({ name: 'use_internal', default: false })
  useInternal: boolean;

  // ---- live state (written by HttpMonitorService) ----

  @Column({ type: 'varchar', default: 'unknown' })
  status: HttpMonitorStatus;

  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ name: 'status_since', type: 'timestamptz', nullable: true })
  statusSince: Date | null;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ name: 'last_status_code', type: 'int', nullable: true })
  lastStatusCode: number | null;

  @Column({ name: 'last_latency_ms', type: 'int', nullable: true })
  lastLatencyMs: number | null;

  @Column({ name: 'last_error', type: 'varchar', length: 200, nullable: true })
  lastError: string | null;

  /** The URL of the last check (host + path, no credentials), shown read-only in the UI. */
  @Column({ name: 'last_target', type: 'varchar', length: 300, nullable: true })
  lastTarget: string | null;

  @Column({ name: 'last_alert_at', type: 'timestamptz', nullable: true })
  lastAlertAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
