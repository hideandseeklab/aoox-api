import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * An S3-compatible bucket backups are copied to.
 * Platform-wide, managed by owner/admin; the secret key never leaves the API.
 */
@Entity({ name: 'backup_destinations' })
export class BackupDestination {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /** Custom endpoint (MinIO, R2, Backblaze, …); null = AWS S3. */
  @Column({ type: 'varchar', nullable: true })
  endpoint: string | null;

  /** AWS region; empty is fine for most non-AWS providers. */
  @Column({ type: 'varchar', default: '' })
  region: string;

  @Column()
  bucket: string;

  /** Key prefix inside the bucket, without leading/trailing slash (may be empty). */
  @Column({ type: 'varchar', default: '' })
  prefix: string;

  @Column({ name: 'access_key_id' })
  accessKeyId: string;

  /** AES-256-GCM (docker/secret.util). Never selected by default. */
  @Column({ name: 'secret_access_key_encrypted', type: 'text', select: false })
  secretAccessKeyEncrypted: string;

  /** `bucket` in the path instead of the host — required by MinIO, harmless elsewhere. */
  @Column({ name: 'force_path_style', default: true })
  forcePathStyle: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
