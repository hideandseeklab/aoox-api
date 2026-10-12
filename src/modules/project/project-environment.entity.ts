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
import { Project } from './project.entity';

/** Created for every project; `production` is protected and cannot be deleted. */
export const DEFAULT_ENVIRONMENTS = [
  { name: 'development', protected: false },
  { name: 'staging', protected: false },
  { name: 'production', protected: true },
] as const;
export const PRODUCTION_ENVIRONMENT = 'production';

/** Lowercase slug, unique per project. */
export const ENVIRONMENT_NAME = /^[a-z0-9-]{1,32}$/;

/**
 * A named set of environment variables of a project (development, staging,
 * production, ...). Applications and compose stacks are linked to one; the
 * resolver reads it where it used to read `Project.env`. The variables are
 * one `KEY=VALUE` text encrypted at rest (AES-256-GCM, ENCRYPTION_KEY, like
 * other stored secrets); `keys` is a plaintext copy of the names so lists
 * never decrypt anything.
 */
@Entity({ name: 'project_environments' })
@Index('UQ_project_environments_name', ['projectId', 'name'], { unique: true })
export class ProjectEnvironment {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_project_environments',
  })
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'project_id',
    foreignKeyConstraintName: 'FK_project_environments_project',
  })
  project: Project;

  @Column({ type: 'varchar', length: 32 })
  name: string;

  /** Only project admins can reveal or edit the values of a protected environment. */
  @Column({ default: false })
  protected: boolean;

  /** AES-encrypted `KEY=VALUE` text; null = empty. Never selected by default. */
  @Column({
    name: 'variables_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  variablesEncrypted: string | null;

  /** Variable names (no values), for listing without decrypting. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  keys: string[];

  /**
   * Per-key secret flag: `true` = secret (always masked), `false` = explicitly
   * not secret (never masked), absent = unmarked (masked by the length
   * heuristic). Names only, so the `KEY=VALUE` text stays plain.
   */
  @Column({ name: 'secret_flags', type: 'jsonb', default: () => "'{}'" })
  secretFlags: Record<string, boolean>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
