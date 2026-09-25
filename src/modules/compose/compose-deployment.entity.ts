import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ComposeApp } from './compose-app.entity';

/** Same verbs the runner accepts; `down` is recorded too (delete, tear down). */
export type ComposeDeploymentAction = 'deploy' | 'stop' | 'start' | 'down';
export type ComposeDeploymentTrigger = 'manual' | 'webhook';
export type ComposeDeploymentStatus = 'running' | 'success' | 'failed';

/**
 * One run of the compose helper. A stack is N containers, so there is no
 * image or rollback here like `Deployment` has for applications — this is
 * the history of *actions*: what was run, when, by what trigger, and the
 * output it produced. `ComposeApp.logs` keeps only the last run's output;
 * these rows are what survives the next deploy.
 */
@Entity({ name: 'compose_deployments' })
export class ComposeDeployment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'compose_app_id', type: 'uuid' })
  composeAppId: string;

  @ManyToOne(() => ComposeApp, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'compose_app_id' })
  composeApp: ComposeApp;

  @Column({ type: 'varchar' })
  action: ComposeDeploymentAction;

  @Column({ type: 'varchar', default: 'manual' })
  trigger: ComposeDeploymentTrigger;

  @Column({ type: 'varchar', default: 'running' })
  status: ComposeDeploymentStatus;

  /** Helper output, redacted like the row's own logs; flushed every ~1s. */
  @Column({ type: 'text', default: '' })
  logs: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  /** Commit the webhook reported, when it sent one (informational). */
  @Column({ name: 'commit_sha', type: 'varchar', nullable: true })
  commitSha: string | null;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
