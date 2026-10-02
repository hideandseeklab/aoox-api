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
 * A stretch during which a monitor considered the application down: opened
 * when the failure threshold is reached (dated from the first failed check of
 * the streak), closed on the first healthy check. An open row (`ended_at`
 * null) is also how an outage survives an API restart.
 */
@Entity({ name: 'http_incidents' })
@Index(['monitorId', 'startedAt'])
export class HttpIncident {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'monitor_id', type: 'uuid' })
  monitorId: string;

  @ManyToOne(() => HttpMonitor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'monitor_id' })
  monitor: HttpMonitor;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  /** Status code or short error that opened the incident. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  @Column({ name: 'failed_checks', type: 'int', default: 0 })
  failedChecks: number;
}
