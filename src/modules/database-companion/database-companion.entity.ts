import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import type { CompanionToolId } from './companion-tools';

export type CompanionStatus = 'creating' | 'running' | 'stopped' | 'error';

/** The admin web UI container (Adminer, pgAdmin, ...) attached to one managed database. */
@Entity({ name: 'database_companions' })
@Index('UQ_database_companions_database', ['databaseId'], { unique: true })
@Index('UQ_database_companions_host', ['host'], { unique: true })
export class DatabaseCompanion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'database_id', type: 'uuid' })
  databaseId: string;

  @ManyToOne(() => ManagedDatabase, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'database_id',
    foreignKeyConstraintName: 'FK_database_companions_database',
  })
  database: ManagedDatabase;

  @Column({ type: 'varchar' })
  tool: CompanionToolId;

  @Column({ type: 'varchar', default: 'creating' })
  status: CompanionStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  /** Domain routed by the proxy; null = reachable by host port only. */
  @Column({ type: 'varchar', nullable: true })
  host: string | null;

  @Column({ default: false })
  https: boolean;

  @Column({ name: 'host_port', type: 'int', nullable: true })
  hostPort: number | null;

  /** Generated login of the tool (AES, ENCRYPTION_KEY); null for tools using the database login. */
  @Column({
    name: 'password_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  passwordEncrypted: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
