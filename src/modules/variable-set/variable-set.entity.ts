import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Lowercase slug, unique, immutable (API token scopes name sets by slug). */
export const VARIABLE_SET_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * A platform-level group of variables ("Variable set" in the web), with its
 * own environments (development, staging, production, ...). Owned by the
 * platform (owner/admin manage it) and shared with chosen projects or with
 * all of them; applications and compose stacks of those projects link to one
 * or more (set, environment) pairs.
 */
@Entity({ name: 'variable_sets' })
@Index('UQ_variable_sets_name', ['name'], { unique: true })
@Index('UQ_variable_sets_slug', ['slug'], { unique: true })
export class VariableSet {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_variable_sets',
  })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Set at creation from the name (or given), never changed afterwards. */
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Shared with every project (current and future). */
  @Column({ name: 'shared_with_all', default: false })
  sharedWithAll: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
