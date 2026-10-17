import { Column, Entity, PrimaryColumn } from 'typeorm';

export const PANEL_DOMAIN_SETTINGS_ID = 'default';

/** Single-row table: custom domain for the panel's own web/api containers. */
@Entity({ name: 'panel_domain_settings' })
export class PanelDomainSettings {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ name: 'web_host', type: 'varchar', nullable: true })
  webHost: string | null;

  @Column({ name: 'api_host', type: 'varchar', nullable: true })
  apiHost: string | null;

  @Column({ name: 'acme_email', type: 'varchar', nullable: true })
  acmeEmail: string | null;

  /**
   * Opt-in: publish the panel's ports 3000/3001 on 127.0.0.1 only so all
   * outside access goes through the domain (Traefik). Requires both hosts.
   */
  @Column({ name: 'restrict_ports', type: 'boolean', default: false })
  restrictPorts: boolean;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt: Date | null;
}
