import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Application } from '../application/application.entity';
import { Mount } from '../application/mount.entity';
import { BackupDestination } from '../backup-destination/backup-destination.entity';

export type VolumeBackupStatus = 'running' | 'success' | 'failed';
export type VolumeBackupTrigger = 'manual' | 'scheduled';

/** A `tar.gz` of one `volume` mount, stored in the shared backups volume. */
@Entity({ name: 'volume_backups' })
export class VolumeBackup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  @Index()
  @Column({ name: 'mount_id', type: 'uuid' })
  mountId: string;

  @ManyToOne(() => Mount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mount_id' })
  mount: Mount;

  /** Docker volume name at backup time (restore targets the mount's current volume). */
  @Column()
  volume: string;

  /** `<appName>/<mountName>/<ISO stamp>.tar.gz`, relative to the backups volume. */
  @Column()
  filename: string;

  @Column({ type: 'varchar', default: 'running' })
  status: VolumeBackupStatus;

  @Column({ type: 'varchar', default: 'manual' })
  trigger: VolumeBackupTrigger;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | null;

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

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
