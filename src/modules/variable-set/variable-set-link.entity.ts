import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { VariableSetEnvironment } from './variable-set-environment.entity';

/** At most this many (set, environment) links per application or stack. */
export const MAX_LINKS = 10;

/**
 * One (set environment) an application or compose stack receives, at a
 * position: earlier links first, later ones override earlier ones on the
 * same key, the owner's own env always wins.
 *
 * `application_id` / `compose_app_id` have foreign keys (ON DELETE CASCADE)
 * in the hand-written migration only, without TypeORM relations, so this
 * module never imports the application or compose modules (they import it).
 * The environment side is NO ACTION: the service refuses with 409 first.
 */
@Entity({ name: 'variable_set_links' })
@Check(
  'CHK_variable_set_links_owner',
  '("application_id" IS NULL) <> ("compose_app_id" IS NULL)',
)
@Index(
  'UQ_variable_set_links_application',
  ['applicationId', 'environmentId'],
  {
    unique: true,
    where: '"application_id" IS NOT NULL',
  },
)
@Index('UQ_variable_set_links_compose', ['composeAppId', 'environmentId'], {
  unique: true,
  where: '"compose_app_id" IS NOT NULL',
})
export class VariableSetLink {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_variable_set_links',
  })
  id: string;

  @Column({ name: 'environment_id', type: 'uuid' })
  environmentId: string;

  @ManyToOne(() => VariableSetEnvironment, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'environment_id',
    foreignKeyConstraintName: 'FK_variable_set_links_environment',
  })
  environment: VariableSetEnvironment;

  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId: string | null;

  @Column({ name: 'compose_app_id', type: 'uuid', nullable: true })
  composeAppId: string | null;

  /** 0-based order; later positions override earlier ones. */
  @Column({ type: 'int' })
  position: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
