import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SecretProvider = 'infisical';

/**
 * A registered connection to an external secret manager (Infisical, machine
 * identity with Universal Auth). aoox is only a client of an instance the user
 * already has. The client secret is stored encrypted and never returned.
 */
@Entity({ name: 'secret_connections' })
export class SecretConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', default: 'infisical' })
  provider: SecretProvider;

  /** Base URL of a self-hosted instance; null = https://app.infisical.com. */
  @Column({ type: 'varchar', nullable: true })
  url: string | null;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'client_secret_encrypted', type: 'text', select: false })
  clientSecretEncrypted: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
