import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Server } from '../server/server.entity';

/**
 * One Traefik dynamic-configuration file (file provider) written by the
 * operator, kept here as the source of truth so it can be rewritten to the
 * proxy volume whenever that volume is lost (instance restore, a new server,
 * proxy recreated by hand). On disk it is `user-<name>.yml` in the proxy's
 * dynamic directory; a disabled file is absent from disk but stays here.
 */
@Entity({ name: 'proxy_config_files' })
@Index('UQ_proxy_config_files_server_name', ['serverId', 'name'], {
  unique: true,
  where: '"server_id" IS NOT NULL',
})
@Index('UQ_proxy_config_files_host_name', ['name'], {
  unique: true,
  where: '"server_id" IS NULL',
})
export class ProxyConfigFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Slug, `[a-z0-9-]{1,40}`; unique per daemon. */
  @Column()
  name: string;

  /** The remote server whose proxy loads this file; null = the aoox host. */
  @Column({ name: 'server_id', type: 'uuid', nullable: true })
  serverId: string | null;

  @ManyToOne(() => Server, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'server_id',
    foreignKeyConstraintName: 'FK_proxy_config_files_server',
  })
  server: Server | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
