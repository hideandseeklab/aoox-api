import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ChangeSummary, SecretFlags, VariableNotes } from './env-text';
import { VariableSetEnvironment } from './variable-set-environment.entity';

/** How many versions are kept per environment; older ones are pruned on write. */
export const ENV_VERSION_KEEP = 50;

export type VersionVia = 'session' | 'token' | 'system';
export type VersionAction =
  'edit' | 'set' | 'unset' | 'push' | 'restore' | 'promote' | 'baseline';

/**
 * One saved state of an environment's variables. The full text is encrypted
 * like the live one; the summary holds key names only.
 */
@Entity({ name: 'variable_set_environment_versions' })
@Index('IDX_variable_set_environment_versions_env_created', [
  'environmentId',
  'createdAt',
])
export class VariableSetEnvironmentVersion {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_variable_set_environment_versions',
  })
  id: string;

  @Column({ name: 'environment_id', type: 'uuid' })
  environmentId: string;

  @ManyToOne(() => VariableSetEnvironment, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'environment_id',
    foreignKeyConstraintName:
      'FK_variable_set_environment_versions_environment',
  })
  environment: VariableSetEnvironment;

  /** AES-encrypted full `KEY=VALUE` text; null = empty. Never selected by default. */
  @Column({
    name: 'variables_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  variablesEncrypted: string | null;

  @Column({ name: 'secret_flags', type: 'jsonb', default: () => "'{}'" })
  secretFlags: SecretFlags;

  /** Notes of this version's text (name -> text), like the live column. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  notes: VariableNotes;

  /** Null once the author's account is deleted (FK ON DELETE SET NULL, hand-written migration). */
  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  /** Email at the time of the change. */
  @Column({
    name: 'author_email',
    type: 'varchar',
    length: 320,
    nullable: true,
  })
  authorEmail: string | null;

  @Column({ type: 'varchar', length: 16 })
  via: VersionVia;

  @Column({ type: 'varchar', length: 16 })
  action: VersionAction;

  /** Short note, e.g. `from staging`. No values. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  detail: string | null;

  @Column({ type: 'jsonb' })
  summary: ChangeSummary;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
  })
  createdAt: Date;
}
