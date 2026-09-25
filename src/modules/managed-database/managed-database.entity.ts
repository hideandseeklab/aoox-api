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
import { BackupDestination } from '../backup-destination/backup-destination.entity';
import { Project } from '../project/project.entity';

export type DatabaseEngine = 'postgres' | 'mysql' | 'mariadb' | 'redis';
export type ManagedDatabaseStatus =
  'creating' | 'running' | 'stopped' | 'error';

/** A database server run as a managed container inside a project. */
@Entity({ name: 'managed_databases' })
export class ManagedDatabase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column()
  name: string;

  /** Unique slug: container `aoox-db-<slug>`, volume `aoox_db_<slug>`. */
  @Index({ unique: true })
  @Column({ name: 'db_slug' })
  slug: string;

  @Column({ type: 'varchar' })
  engine: DatabaseEngine;

  /** Image tag, e.g. `16-alpine` for postgres. */
  @Column({ name: 'image_tag' })
  imageTag: string;

  /** Logical database name (unused for redis). */
  @Column({ name: 'database_name' })
  databaseName: string;

  @Column()
  username: string;

  @Column({ name: 'password_encrypted', type: 'text', select: false })
  passwordEncrypted: string;

  /** Host port to publish; null = reachable only from the aoox network. */
  @Column({ name: 'host_port', type: 'int', nullable: true })
  hostPort: number | null;

  /** CPU limit in millicores (1000 = one core); null = unlimited. */
  @Column({ name: 'cpu_millicores', type: 'int', nullable: true })
  cpuMillicores: number | null;

  /** Memory limit in MiB (hard: swap pinned to the same value); null = unlimited. */
  @Column({ name: 'memory_mb', type: 'int', nullable: true })
  memoryMb: number | null;

  @Column({ type: 'varchar', default: 'creating' })
  status: ManagedDatabaseStatus;

  /** Cron expression (5 fields) for automatic backups; null = disabled. */
  @Column({ name: 'backup_cron', type: 'varchar', nullable: true })
  backupCron: string | null;

  /** How many scheduled backups to keep; older ones are deleted. */
  @Column({ name: 'backup_keep', type: 'int', default: 7 })
  backupKeep: number;

  /** Dump every database on the server (see schemas/), not just the primary one. */
  @Column({ name: 'backup_all_databases', default: false })
  backupAllDatabases: boolean;

  /** Off-site copy of every backup; null = local volume only. */
  @Column({ name: 'backup_destination_id', type: 'uuid', nullable: true })
  backupDestinationId: string | null;

  @ManyToOne(() => BackupDestination, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'backup_destination_id' })
  backupDestination: BackupDestination | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
