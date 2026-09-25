import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'owner' | 'admin' | 'member';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', default: 'member' })
  role: UserRole;

  /** TOTP secret (base32) encrypted with ENCRYPTION_KEY; set at setup, active once `totpEnabled`. */
  @Column({
    name: 'totp_secret_encrypted',
    type: 'varchar',
    nullable: true,
    select: false,
  })
  totpSecretEncrypted: string | null;

  @Column({ name: 'totp_enabled', default: false })
  totpEnabled: boolean;

  /** SHA-256 of unused backup codes; a code is removed when used. */
  @Column({
    name: 'totp_backup_hashes',
    type: 'jsonb',
    nullable: true,
    select: false,
  })
  totpBackupHashes: string[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
