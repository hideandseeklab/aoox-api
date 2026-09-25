import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { BackupDestination } from '../backup-destination/backup-destination.entity';

export const INSTANCE_SETTINGS_ID = 'default';

/** Single-row table: schedule of the instance snapshot (same shape as a database's backup schedule). */
@Entity({ name: 'instance_backup_settings' })
export class InstanceBackupSettings {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ name: 'backup_cron', type: 'varchar', nullable: true })
  backupCron: string | null;

  @Column({ name: 'backup_keep', type: 'integer', default: 7 })
  backupKeep: number;

  @Column({ name: 'destination_id', type: 'uuid', nullable: true })
  destinationId: string | null;

  @ManyToOne(() => BackupDestination, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'destination_id' })
  destination: BackupDestination | null;
}
