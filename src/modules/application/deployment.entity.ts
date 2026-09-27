import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Application } from './application.entity';

/** `auto-update` = a build-style deployment queued by the image update watcher. */
/** `config` = re-run the current image so runtime config (mode, replicas, node…) applies; no build. */
export type DeploymentKind = 'build' | 'rollback' | 'auto-update' | 'config';

export type DeploymentStatus =
  'queued' | 'building' | 'pushing' | 'starting' | 'success' | 'failed';

/**
 * Who/what actually queued the deployment — separate from `kind` (which
 * selects the build/rollback/config code path). `rollback` and `config`
 * kinds are always user actions, so they carry `trigger: 'manual'` too;
 * `triggeredBy` is what tells them apart from an ordinary manual deploy.
 */
export type DeploymentTrigger = 'manual' | 'webhook' | 'auto-update';

@Entity({ name: 'deployments' })
export class Deployment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ type: 'varchar', default: 'queued' })
  status: DeploymentStatus;

  /** `rollback` reuses an earlier image instead of building. */
  @Column({ type: 'varchar', default: 'build' })
  kind: DeploymentKind;

  /** For rollbacks: the deployment whose image was reused. */
  @Column({ name: 'rolled_back_from_id', type: 'uuid', nullable: true })
  rolledBackFromId: string | null;

  /** Full image reference that was built/pushed, e.g. `localhost:5000/proj/app:abc123`. */
  @Column({ name: 'image_ref', type: 'varchar', nullable: true })
  imageRef: string | null;

  @Column({ type: 'text', default: '' })
  logs: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'varchar', default: 'manual' })
  trigger: DeploymentTrigger;

  /** Commit the webhook reported, when it sent one (informational). */
  @Column({ name: 'commit_sha', type: 'varchar', nullable: true })
  commitSha: string | null;

  /** First line of the commit message, truncated; also from the webhook. */
  @Column({ name: 'commit_message', type: 'text', nullable: true })
  commitMessage: string | null;

  /** Email of the actor for `manual`, or the git provider's pusher name for `webhook`. */
  @Column({ name: 'triggered_by', type: 'varchar', nullable: true })
  triggeredBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
