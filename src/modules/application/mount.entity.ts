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
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import { Application } from './application.entity';

/**
 * `volume`: a named Docker volume (`aoox_app_<appName>_<name>`) —
 *   persistent data that survives redeploys.
 * `bind`: a directory/file on the (deploy) host, `hostPath`.
 * `file`: a small config file whose `content` lives in the row; written into
 *   the app's files volume and bind-mounted read-only at `containerPath`.
 */
export type MountType = 'volume' | 'bind' | 'file';

@Entity({ name: 'mounts' })
@Index(['applicationId', 'containerPath'], { unique: true })
@Index(['databaseId', 'containerPath'], { unique: true })
@Index(['composeAppId', 'service', 'containerPath'], { unique: true })
export class Mount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Exactly one of `applicationId` / `databaseId` / `composeAppId` is set. */
  @Index()
  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId: string | null;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application | null;

  @Index()
  @Column({ name: 'database_id', type: 'uuid', nullable: true })
  databaseId: string | null;

  @ManyToOne(() => ManagedDatabase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'database_id' })
  database: ManagedDatabase | null;

  /**
   * No `@ManyToOne`/entity import here: ComposeModule already imports
   * ApplicationModule (for env resolution and the host-port check), so the
   * reverse relation would be a module cycle. The FK (`ON DELETE CASCADE`)
   * is created in the migration by raw SQL instead — same cascade behaviour,
   * no relation object needed since nothing here ever joins through it.
   */
  @Index()
  @Column({ name: 'compose_app_id', type: 'uuid', nullable: true })
  composeAppId: string | null;

  /** Which service in the stack this mount attaches to (`composeAppId` only). */
  @Column({ type: 'varchar', nullable: true })
  service: string | null;

  @Column({ type: 'varchar' })
  type: MountType;

  /** Volume suffix (`volume`) or file name (`file`); null for `bind`. */
  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  /** Absolute path on the host (`bind` only). */
  @Column({ name: 'host_path', type: 'varchar', nullable: true })
  hostPath: string | null;

  /** File body (`file` only). */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  /** Absolute path inside the container. */
  @Column({ name: 'container_path' })
  containerPath: string;

  @Column({ name: 'read_only', default: false })
  readOnly: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
