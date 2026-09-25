import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../user/user.entity';
import { ManagedDatabase } from '../managed-database.entity';

/**
 * A statement/command one user ran through the data browser, kept so they
 * can find and re-run it later — like phpMyAdmin's query history, per user,
 * not a shared or audited log (the audit log already covers `POST …/query`
 * platform-wide). The text is stored as typed, with no redaction: SQL has
 * no fixed key names to redact against, so a pasted `CREATE USER … PASSWORD`
 * lands here verbatim. That is a known property, not an oversight — this
 * is "what did I just run", visible only to the user who ran it.
 */
@Entity({ name: 'query_history' })
@Index(['databaseId', 'userId', 'createdAt'])
export class QueryHistoryEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'database_id', type: 'uuid' })
  databaseId: string;

  @ManyToOne(() => ManagedDatabase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'database_id' })
  database: ManagedDatabase;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Another database on the same server (see schemas/); null = the primary one. */
  @Column({ type: 'varchar', nullable: true })
  db: string | null;

  /** Capped before insert; see QueryHistoryService.record. */
  @Column({ type: 'text' })
  sql: string;

  @Column({ type: 'boolean' })
  success: boolean;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'row_count', type: 'int', nullable: true })
  rowCount: number | null;

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
