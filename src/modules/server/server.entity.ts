import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A remote machine aoox can open a shell on over SSH. By default the platform's own generated key
 * (SshKeyService) is used and the user authorizes its public half on the
 * server once; a per-server private key can be stored instead.
 */
@Entity({ name: 'servers' })
export class Server {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  host: string;

  @Column({ type: 'int', default: 22 })
  port: number;

  @Column()
  username: string;

  /** AES-256-GCM (docker/secret.util). Null = use the platform key. */
  @Column({
    name: 'private_key_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  privateKeyEncrypted: string | null;

  /** Traefik on this server (Servers → Proxy); same semantics as PROXY_* env for the host. */
  @Column({ name: 'proxy_http_port', type: 'int', default: 80 })
  proxyHttpPort: number;

  @Column({ name: 'proxy_https_port', type: 'int', default: 443 })
  proxyHttpsPort: number;

  @Column({ name: 'acme_email', type: 'varchar', nullable: true })
  acmeEmail: string | null;

  @Column({ name: 'acme_staging', default: false })
  acmeStaging: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Proxy settings of a server in the shape ProxyService expects. */
export function proxySettingsOf(server: Server): {
  httpPort: number;
  httpsPort: number;
  acmeEmail: string | null;
  acmeStaging: boolean;
} {
  return {
    httpPort: server.proxyHttpPort,
    httpsPort: server.proxyHttpsPort,
    acmeEmail: server.acmeEmail,
    acmeStaging: server.acmeStaging,
  };
}
