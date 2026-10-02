import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { HttpMonitor } from './http-monitor.entity';

/**
 * One result of a monitor. Only the outcome is kept — never the response
 * body or headers. Pruned by age and by count (HttpMonitorService.prune).
 */
@Entity({ name: 'http_checks' })
@Index(['monitorId', 'at'])
export class HttpCheck {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'monitor_id', type: 'uuid' })
  monitorId: string;

  @ManyToOne(() => HttpMonitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'monitor_id' })
  monitor: HttpMonitor;

  @Column({ type: 'timestamptz' })
  at: Date;

  @Column()
  ok: boolean;

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode: number | null;

  @Column({ name: 'latency_ms', type: 'int' })
  latencyMs: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  error: string | null;
}
