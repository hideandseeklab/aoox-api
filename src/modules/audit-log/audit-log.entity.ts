import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per state-changing request (and per sign-in attempt). Written by
 * the global interceptor after the handler finished, so `status` reflects
 * what actually happened. Actor fields are snapshots: they stay readable
 * after the user or token is deleted.
 */
@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_email', type: 'varchar', nullable: true })
  actorEmail: string | null;

  /** `session` (JWT), `token` (API token), `webhook`, or `anonymous` (sign-in/setup). */
  @Column({ type: 'varchar' })
  via: string;

  @Column({ name: 'token_id', type: 'uuid', nullable: true })
  tokenId: string | null;

  /** `POST /applications/:id/deploy` — the route template, stable across ids. */
  @Index()
  @Column()
  action: string;

  @Column()
  method: string;

  /** Concrete path as requested (ids filled in). */
  @Column()
  path: string;

  /** Route params, e.g. `{ id }` — the target of the action. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  params: Record<string, string>;

  /** Request body with secrets redacted and size capped; null for bodyless requests. */
  @Column({ type: 'jsonb', nullable: true })
  body: Record<string, unknown> | null;

  @Column({ type: 'int' })
  status: number;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
