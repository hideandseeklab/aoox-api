import {
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
import { ComposeApp } from '../compose/compose-app.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';

/**
 * `container`: `docker exec` inside the running app container (fast, shares
 *   its process namespace — e.g. `php artisan schedule:run`).
 * `run`: a throwaway container from the app's current image with the same
 *   env and mounts (heavy work that must not disturb the app, or when the
 *   app is stopped).
 */
export type JobTarget = 'container' | 'run';
export type JobRunStatus = 'running' | 'success' | 'failed' | 'timeout';

/** A cron-scheduled command for an application. */
@Entity({ name: 'jobs' })
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Exactly one owner: application, managed database or compose stack. */
  @Index()
  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId: string | null;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application | null;

  @Index()
  @Column({ name: 'database_id', type: 'uuid', nullable: true })
  databaseId: string | null;

  @ManyToOne(() => ManagedDatabase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'database_id' })
  database: ManagedDatabase | null;

  @Index()
  @Column({ name: 'compose_app_id', type: 'uuid', nullable: true })
  composeAppId: string | null;

  @ManyToOne(() => ComposeApp, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'compose_app_id' })
  composeApp: ComposeApp | null;

  /** Compose only: which service's container to exec in / whose image to run. */
  @Column({ type: 'varchar', nullable: true })
  service: string | null;

  @Column()
  name: string;

  /** 5-field cron expression; null = manual only. */
  @Column({ type: 'varchar', nullable: true })
  cron: string | null;

  /** Run with `sh -c`. */
  @Column({ type: 'text' })
  command: string;

  @Column({ type: 'varchar', default: 'container' })
  target: JobTarget;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'timeout_seconds', type: 'int', default: 600 })
  timeoutSeconds: number;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ name: 'last_status', type: 'varchar', nullable: true })
  lastStatus: JobRunStatus | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
