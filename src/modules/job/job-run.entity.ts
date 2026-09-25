import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Job } from './job.entity';
import type { JobRunStatus } from './job.entity';

export type JobTrigger = 'manual' | 'scheduled';

/** One execution of a job; the newest `JOB_RUN_KEEP` per job are kept. */
@Entity({ name: 'job_runs' })
export class JobRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => Job, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: Job;

  @Column({ type: 'varchar' })
  status: JobRunStatus;

  @Column({ type: 'varchar' })
  trigger: JobTrigger;

  @Column({ name: 'exit_code', type: 'int', nullable: true })
  exitCode: number | null;

  /** Combined stdout/stderr, capped. */
  @Column({ type: 'text', default: '' })
  output: string;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
