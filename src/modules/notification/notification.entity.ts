import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type NotificationType =
  'telegram' | 'slack' | 'discord' | 'webhook' | 'email';

/** Per-type settings, stored encrypted as JSON (`configEncrypted`). */
export type NotificationConfig =
  | { type: 'telegram'; botToken: string; chatId: string }
  | { type: 'slack'; webhookUrl: string }
  | { type: 'discord'; webhookUrl: string }
  /** `secret` (optional) signs each delivery: `X-Aoox-Signature: sha256=<hmac>`. */
  | { type: 'webhook'; url: string; secret?: string | null }
  | {
      type: 'email';
      /** SMTP server; credentials live here, not in env, like every other channel. */
      host: string;
      port: number;
      secure: boolean;
      username: string | null;
      password: string | null;
      from: string;
      to: string[];
    };

/**
 * A channel deployment events are posted to.
 * Platform-wide, managed by owner/admin. Tokens and webhook URLs are secrets
 * and never leave the API.
 */
@Entity({ name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  type: NotificationType;

  /** AES-256-GCM JSON (docker/secret.util). Never selected by default. */
  @Column({ name: 'config_encrypted', type: 'text', select: false })
  configEncrypted: string;

  @Column({ name: 'on_deployment_success', default: true })
  onDeploymentSuccess: boolean;

  @Column({ name: 'on_deployment_failure', default: true })
  onDeploymentFailure: boolean;

  @Column({ name: 'on_backup_failure', default: true })
  onBackupFailure: boolean;

  @Column({ name: 'on_job_failure', default: true })
  onJobFailure: boolean;

  /** Docker disk above `DISK_ALERT_PERCENT` (daily check). */
  @Column({ name: 'on_disk_low', default: true })
  onDiskLow: boolean;

  /** Traefik could not obtain/renew an ACME certificate. */
  @Column({ name: 'on_certificate_failure', default: true })
  onCertificateFailure: boolean;

  /** A managed app/database container exited unexpectedly. */
  @Column({ name: 'on_container_down', default: true })
  onContainerDown: boolean;

  /** A domain's DNS stopped pointing where the app is actually served. */
  @Column({ name: 'on_dns_issue', default: true })
  onDnsIssue: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
