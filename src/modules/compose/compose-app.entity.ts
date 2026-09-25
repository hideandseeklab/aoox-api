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
import { GitCredential } from '../git-credential/git-credential.entity';
import { Project } from '../project/project.entity';

export type ComposeAppStatus =
  'idle' | 'deploying' | 'running' | 'stopped' | 'error';

/** `git` = cloned from a repository; `template` = compose file stored in `composeContent`. */
export type ComposeAppSource = 'git' | 'template';

/**
 * A stack service published through the platform proxy. Rendered into an
 * override compose file with the same Traefik labels applications get, so
 * template stacks reach a domain without hand-written labels.
 */
export interface ComposeServiceDomain {
  service: string;
  port: number;
  host: string;
  https: boolean;
}

/**
 * A stack service published directly on a host port (`ports:` in the
 * override), for access by IP without a domain or the proxy.
 */
export interface ComposeServicePort {
  service: string;
  /** Container port. */
  port: number;
  hostPort: number;
}

/**
 * A per-service CPU/RAM cap, written into the override's `deploy.resources.limits`
 * — honoured by plain `docker compose up` (no swarm needed) since Compose v2.
 * Either field omitted/null = unlimited for that resource.
 */
export interface ComposeServiceResources {
  service: string;
  cpuMillicores: number | null;
  memoryMb: number | null;
}

/**
 * A docker-compose stack from a git repository. Runs as its own compose project `aoox-<slug>`; the
 * checkout lives in volume `aoox_compose_<slug>` so stop/start/down
 * can run against the same files later.
 */
@Entity({ name: 'compose_apps' })
export class ComposeApp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column()
  name: string;

  /** Unique; compose project `aoox-<slug>`, volume `aoox_compose_<slug>`. */
  @Index({ unique: true })
  @Column()
  slug: string;

  @Column({ type: 'varchar', default: 'git' })
  source: ComposeAppSource;

  /** Catalog id when created from a template (informational). */
  @Column({ name: 'template_id', type: 'varchar', nullable: true })
  templateId: string | null;

  /** Compose file for `template` stacks; written into the checkout volume on each deploy. */
  @Column({ name: 'compose_content', type: 'text', nullable: true })
  composeContent: string | null;

  /** Only for `git` stacks. */
  @Column({ name: 'git_url', type: 'varchar', nullable: true })
  gitUrl: string | null;

  @Column({ name: 'git_branch', default: 'main' })
  gitBranch: string;

  @Column({ name: 'git_credential_id', type: 'uuid', nullable: true })
  gitCredentialId: string | null;

  @ManyToOne(() => GitCredential, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'git_credential_id' })
  gitCredential: GitCredential | null;

  /**
   * Unguessable token in the stack's webhook URL
   * (`POST /webhooks/compose/<token>`). Never selected by default.
   */
  @Column({
    name: 'webhook_token',
    type: 'varchar',
    unique: true,
    select: false,
  })
  webhookToken: string;

  /**
   * Optional shared secret the provider must prove on each delivery
   * (GitHub HMAC / GitLab token), encrypted like every other secret; the
   * token itself stays plaintext because it is the lookup key.
   */
  @Column({
    name: 'webhook_secret_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  webhookSecretEncrypted: string | null;

  /** Compose file, relative to the repository root. */
  @Column({ name: 'compose_path', default: 'docker-compose.yml' })
  composePath: string;

  /**
   * `KEY=VALUE` lines written to `.aoox.env` and passed with
   * `--env-file`, so `${VAR}` in the compose file resolves. Same references
   * as applications (`${{project.KEY}}`, `${{database.<slug>.url}}`).
   */
  @Column({ type: 'text', default: '' })
  env: string;

  /** Services exposed via Traefik (override file `docker-compose.aoox.yml`). */
  @Column({ name: 'service_domains', type: 'jsonb', default: () => "'[]'" })
  serviceDomains: ComposeServiceDomain[];

  /** Services published on host ports (same override file). */
  @Column({ name: 'service_ports', type: 'jsonb', default: () => "'[]'" })
  servicePorts: ComposeServicePort[];

  /** Per-service CPU/RAM caps (same override file). */
  @Column({ name: 'service_resources', type: 'jsonb', default: () => "'[]'" })
  serviceResources: ComposeServiceResources[];

  @Column({ type: 'varchar', default: 'idle' })
  status: ComposeAppStatus;

  /** Output of the last deploy/stop/start/down run. */
  @Column({ type: 'text', default: '' })
  logs: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'deployed_at', type: 'timestamptz', nullable: true })
  deployedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
