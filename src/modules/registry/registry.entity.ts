import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BackupDestination } from '../backup-destination/backup-destination.entity';

export type RegistryType = 'self-hosted' | 'external';

/** A Docker registry images can be pushed to / pulled from. Platform-wide. */
@Entity({ name: 'registries' })
export class Registry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  type: RegistryType;

  /** Host[:port] as used by `docker push`, e.g. `localhost:5000`, `ghcr.io`. */
  @Column()
  url: string;

  @Column({ type: 'varchar', nullable: true })
  username: string | null;

  /** AES-256-GCM, see registry-secret.util.ts. Never selected by default. */
  @Column({
    name: 'password_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  passwordEncrypted: string | null;

  /** Optional namespace prefix for pushed images, e.g. `myorg`. */
  @Column({ name: 'image_prefix', type: 'varchar', nullable: true })
  imagePrefix: string | null;

  /**
   * Custom domain for the self-hosted registry, routed through the built-in
   * proxy (Traefik) with ACME — null means it's reached via `url` (host:port)
   * directly. Always null for external registries.
   */
  @Column({ type: 'varchar', nullable: true })
  domain: string | null;

  /**
   * S3-compatible bucket the self-hosted registry stores image data in
   * (reuses the same `BackupDestination` credentials used for database/volume
   * backups) — null means local disk (`aoox_registry_data` volume), the
   * default. Set once at provision time; always null for external registries.
   */
  @Column({ name: 'storage_destination_id', type: 'uuid', nullable: true })
  storageDestinationId: string | null;

  @ManyToOne(() => BackupDestination, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'storage_destination_id' })
  storageDestination: BackupDestination | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
