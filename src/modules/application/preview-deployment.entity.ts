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
import { Application } from './application.entity';

export type PreviewStatus = 'building' | 'running' | 'failed' | 'closed';

/**
 * A pull-request preview: the PR's head branch built and run beside the
 * application under its own container and host
 * (`<appName>-pr<N>.<previewDomain>`). Created/rebuilt/destroyed from
 * provider webhooks; one row per open PR.
 */
@Entity({ name: 'preview_deployments' })
@Index(['applicationId', 'prNumber'], { unique: true })
export class PreviewDeployment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Column({ name: 'pr_number', type: 'int' })
  prNumber: number;

  @Column({ type: 'varchar' })
  title: string;

  /** PR head branch (source branch on GitLab). */
  @Column()
  branch: string;

  @Column({ name: 'commit_sha', type: 'varchar', nullable: true })
  commitSha: string | null;

  /** Link to the PR on the provider. */
  @Column({ name: 'pr_url', type: 'varchar', nullable: true })
  prUrl: string | null;

  /** Public host the preview answers on (null without a preview domain). */
  @Column({ type: 'varchar', nullable: true })
  host: string | null;

  @Column({ type: 'varchar', default: 'building' })
  status: PreviewStatus;

  @Column({ name: 'image_ref', type: 'varchar', nullable: true })
  imageRef: string | null;

  /** Output of the last build. */
  @Column({ type: 'text', default: '' })
  logs: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
