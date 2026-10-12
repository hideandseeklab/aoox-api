import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CustomCertificate } from '../certificate/certificate.entity';
import { ManagedRecord } from '../dns-provider/dns-records';
import { Application } from './application.entity';

export type DomainCertMode = 'http' | 'dns' | 'dns-wildcard';

/** A hostname routed by the proxy to an application container. */
@Entity({ name: 'domains' })
export class Domain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application: Application;

  /** FQDN, lowercase, e.g. `app.example.com`. Unique across the install. */
  @Index({ unique: true })
  @Column()
  host: string;

  /** Also serve on the websecure entrypoint with an ACME certificate. */
  @Column({ default: false })
  https: boolean;

  /**
   * Uploaded certificate to serve instead of ACME (only meaningful with
   * `https`). RESTRICT: a certificate in use cannot be deleted.
   */
  @Index('IDX_domains_certificate_id')
  @Column({ name: 'certificate_id', type: 'uuid', nullable: true })
  certificateId: string | null;

  @ManyToOne(() => CustomCertificate, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'certificate_id',
    foreignKeyConstraintName: 'FK_domains_certificate',
  })
  certificate: CustomCertificate | null;

  /**
   * Traefik middlewares to put in front of this host, as `name@file` from the
   * operator's dynamic config files on the application's proxy.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  middlewares: string[];

  /**
   * How the ACME certificate is obtained (https, no uploaded certificate):
   * `http` = HTTP-01 per host (default), `dns` = DNS-01 per host,
   * `dns-wildcard` = one DNS-01 wildcard for the parent domain. The DNS
   * modes need DNS-01 enabled on the application's proxy.
   */
  @Column({ name: 'cert_mode', type: 'varchar', default: 'http' })
  certMode: DomainCertMode;

  /** DNS connection that manages this host's record; null = DNS is up to the user. */
  @Index('IDX_domains_dns_connection_id')
  @Column({ name: 'dns_connection_id', type: 'uuid', nullable: true })
  dnsConnectionId: string | null;

  /** Cloudflare "proxied" (orange cloud) flag for the managed record. */
  @Column({ name: 'dns_proxied', default: false })
  dnsProxied: boolean;

  /** Records aoox created for this host: the only ones it may delete. */
  @Column({ name: 'dns_records', type: 'jsonb', default: () => "'[]'" })
  dnsRecords: ManagedRecord[];

  /** Result of the last record sync: ok | warning | error. */
  @Column({ name: 'dns_status', type: 'varchar', nullable: true })
  dnsStatus: 'ok' | 'warning' | 'error' | null;

  @Column({ name: 'dns_message', type: 'text', nullable: true })
  dnsMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
