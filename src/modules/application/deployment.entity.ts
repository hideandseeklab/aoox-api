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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
