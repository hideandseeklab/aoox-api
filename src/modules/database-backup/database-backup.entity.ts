import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BackupDestination } from '../backup-destination/backup-destination.entity';
import { ManagedDatabase } from '../managed-database/managed-database.entity';

export type BackupStatus = 'running' | 'success' | 'failed';
export type BackupTrigger = 'manual' | 'scheduled';
/** `database` = the primary database only; `all` = every non-system database on the server. */
export type BackupScope = 'database' | 'all';

/** One dump of a managed database, stored as a file in the backups volume. */
@Entity({ name: 'database_backups' })
export class DatabaseBackup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'database_id', type: 'uuid' })
  databaseId: string;

  @ManyToOne(() => ManagedDatabase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'database_id' })
  database: ManagedDatabase;

  /** Path inside the backups volume, e.g. `<slug>/2026-09-21T10-00-00Z.sql.gz`. */
  @Column()
  filename: string;

  @Column({ type: 'varchar', default: 'running' })
  status: BackupStatus;

  @Column({ type: 'varchar', default: 'manual' })
  trigger: BackupTrigger;

  /** Decides which restore recipe applies. */
  @Column({ type: 'varchar', default: 'database' })
  scope: BackupScope;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | null;

  /** Destination the copy went to (SET NULL if it is deleted later). */
  @Column({ name: 'destination_id', type: 'uuid', nullable: true })
  destinationId: string | null;

  @ManyToOne(() => BackupDestination, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'destination_id' })
  destination: BackupDestination | null;

  /** Object key in the destination bucket once uploaded. */
  @Column({ name: 'remote_key', type: 'varchar', nullable: true })
  remoteKey: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
