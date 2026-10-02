import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ServerHealthStatus = 'unknown' | 'up' | 'down';

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

  /** Last result of the periodic reachability check (ServerHealthService). */
  @Column({ name: 'health_status', type: 'varchar', default: 'unknown' })
  healthStatus: ServerHealthStatus;

  @Column({ name: 'health_checked_at', type: 'timestamptz', nullable: true })
  healthCheckedAt: Date | null;

  /** When `healthStatus` last changed — "down since". */
  @Column({ name: 'health_changed_at', type: 'timestamptz', nullable: true })
  healthChangedAt: Date | null;

  @Column({ name: 'health_error', type: 'text', nullable: true })
  healthError: string | null;

  /** Running `aoox.component` containers seen by the last check. */
  @Column({ name: 'monitored_containers', type: 'int', nullable: true })
  monitoredContainers: number | null;

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
