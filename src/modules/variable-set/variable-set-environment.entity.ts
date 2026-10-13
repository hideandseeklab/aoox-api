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
import { VariableSet } from './variable-set.entity';

/** Created with every new set; `production` is protected. */
export const DEFAULT_ENVIRONMENTS = [
  { name: 'development', protected: false },
  { name: 'staging', protected: false },
  { name: 'production', protected: true },
] as const;

/** Lowercase slug, unique per set. */
export const ENVIRONMENT_NAME = /^[a-z0-9-]{1,32}$/;

/**
 * One environment of a variable set (development, staging, production, ...).
 * The variables are one `KEY=VALUE` text encrypted at rest (AES-256-GCM,
 * ENCRYPTION_KEY, like other stored secrets); `keys` is a plaintext copy of
 * the names so lists never decrypt anything.
 */
@Entity({ name: 'variable_set_environments' })
@Index('UQ_variable_set_environments_name', ['variableSetId', 'name'], {
  unique: true,
})
export class VariableSetEnvironment {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_variable_set_environments',
  })
  id: string;

  @Column({ name: 'variable_set_id', type: 'uuid' })
  variableSetId: string;

  @ManyToOne(() => VariableSet, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'variable_set_id',
    foreignKeyConstraintName: 'FK_variable_set_environments_set',
  })
  variableSet: VariableSet;

  @Column({ type: 'varchar', length: 32 })
  name: string;

  /** Only platform owners/admins can reveal or edit the values of a protected environment. */
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
