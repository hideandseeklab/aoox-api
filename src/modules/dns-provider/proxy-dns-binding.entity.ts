import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Which DNS provider connection a proxy uses for ACME DNS-01 challenges.
 * `server_id` null = the proxy on the aoox host. One binding per proxy
 * (partial unique indexes, as for the dynamic config files).
 */
@Entity({ name: 'proxy_dns_bindings' })
@Index('UQ_proxy_dns_bindings_server', ['serverId'], {
  unique: true,
  where: '"server_id" IS NOT NULL',
})
export class ProxyDnsBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'server_id', type: 'uuid', nullable: true })
  serverId: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
