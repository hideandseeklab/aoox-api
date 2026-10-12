import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type DnsProviderKind = 'cloudflare';

/**
 * A registered DNS provider account (Cloudflare API token). Used to create
 * records for application domains and to answer ACME DNS-01 challenges on a
 * proxy. The token is stored encrypted and never returned.
 */
@Entity({ name: 'dns_provider_connections' })
export class DnsProviderConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', default: 'cloudflare' })
  provider: DnsProviderKind;

  @Column({ name: 'api_token_encrypted', type: 'text', select: false })
  apiTokenEncrypted: string;

  /** Only needed to verify account-owned tokens; null = user token. */
  @Column({ name: 'account_id', type: 'varchar', nullable: true })
  accountId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
