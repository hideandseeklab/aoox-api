import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BackupDestination } from '../backup-destination/backup-destination.entity';

export type InstanceBackupStatus = 'success' | 'failed';
export type InstanceBackupTrigger = 'manual' | 'scheduled';

/**
 * One snapshot of the panel's own database (every table, secrets still
 * encrypted with ENCRYPTION_KEY), stored as `_instance/<stamp>.json.gz` in
 * the backups volume. Rows are written once the dump has finished, so a
 * snapshot never contains itself as "running".
 */
@Entity({ name: 'instance_backups' })
export class InstanceBackup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  filename: string;

  @Column({ type: 'varchar' })
  status: InstanceBackupStatus;

  @Column({ type: 'varchar', default: 'manual' })
  trigger: InstanceBackupTrigger;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | null;

  /** Total rows across all tables — a quick sanity number for the list. */
  @Column({ name: 'row_count', type: 'integer', default: 0 })
  rowCount: number;

  /** Name of the last migration applied when the snapshot was taken. */
  @Column({ name: 'schema_version', type: 'varchar', nullable: true })
  schemaVersion: string | null;

  @Column({ name: 'destination_id', type: 'uuid', nullable: true })
  destinationId: string | null;

  @ManyToOne(() => BackupDestination, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'destination_id' })
  destination: BackupDestination | null;

  @Column({ name: 'remote_key', type: 'varchar', nullable: true })
  remoteKey: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
