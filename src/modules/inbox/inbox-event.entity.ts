import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One thing worth telling the operators about, kept in the app regardless of
 * whether any notification channel (or toggle) wanted it. The text is the
 * same already-redacted text the channels get. `projectId` null = a platform
 * event (disk, servers, certificatesâ€¦), visible to owners/admins only.
 * The FK to `projects` (cascade) lives in the migration, not as a relation.
 */
@Entity({ name: 'inbox_events' })
export class InboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Notification event key, e.g. `deploymentFailure`. */
  @Column({ type: 'varchar' })
  event: string;

  @Column({ type: 'varchar' })
  level: 'success' | 'failure' | 'info';

  @Column({ type: 'text' })
  title: string;

  /** The message's fields on one short line. */
  @Column({ type: 'text', default: '' })
  summary: string;

  /**
   * Structured facts (`variant`, names, counts…) the web turns into a localized
   * sentence; null on rows from before this existed. Never holds secrets or raw logs.
   */
  @Column({ type: 'jsonb', nullable: true })
  params: Record<string, string | number | boolean | null> | null;

  /** Path inside the web app (never an absolute URL), or null. */
  @Column({ type: 'varchar', nullable: true })
  link: string | null;

  @Index()
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
