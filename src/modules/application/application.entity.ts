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
import { Server } from '../server/server.entity';
import { BackupDestination } from '../backup-destination/backup-destination.entity';
import { Project } from '../project/project.entity';
import { Registry } from '../registry/registry.entity';

/** Runtime status as last observed/set by aoox. */
export type ApplicationStatus = 'idle' | 'running' | 'stopped' | 'error';

/** `dockerfile` = build the repo's Dockerfile; `nixpacks` = auto-detect (no Dockerfile needed). */
export type BuildType = 'dockerfile' | 'nixpacks' | 'railpack' | 'static';
export type SourceType = 'git' | 'image';
export type DeployMode = 'container' | 'service';
export type UpdateOrder = 'auto' | 'start-first' | 'stop-first';
/** `node.<attr><op><value>`; attributes and ops the swarm scheduler accepts. */
export const SWARM_CONSTRAINT =
  /^node\.(id|hostname|role|platform\.(os|arch)|labels\.[A-Za-z0-9_.-]+)(==|!=)[A-Za-z0-9_.:/-]+$/;

/** Something deployable inside a project: a git repo built with its Dockerfile. */
@Entity({ name: 'applications' })
export class Application {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column()
  name: string;

  /** Unique slug used for the container name and image repository. */
  @Index({ unique: true })
  @Column({ name: 'app_name' })
  appName: string;

  /** `git` = built from a repository; `image` = a ready-made image is pulled. */
  @Column({ name: 'source_type', type: 'varchar', default: 'git' })
  sourceType: SourceType;

  /** `git` only. */
  @Column({ name: 'git_url', type: 'varchar', nullable: true })
  gitUrl: string | null;

  /** `image` only: full reference, e.g. `ghcr.io/org/app:1.2` or `nginx:1.27`. */
  @Column({ name: 'image_ref', type: 'varchar', nullable: true })
  imageRef: string | null;

  /** `image` only: registry whose credentials authenticate the pull (null = anonymous). */
  @Column({ name: 'image_registry_id', type: 'uuid', nullable: true })
  imageRegistryId: string | null;

  @ManyToOne(() => Registry, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'image_registry_id' })
  imageRegistry: Registry | null;

  /** `image` only: redeploy automatically when the tag's digest changes in the registry. */
  @Column({ name: 'auto_update', default: false })
  autoUpdate: boolean;

  /** Minutes between registry checks (see image-update-watcher.service.ts). */
  @Column({
    name: 'auto_update_interval_minutes',
    type: 'integer',
    default: 60,
  })
  autoUpdateIntervalMinutes: number;

  /** Digest of the image currently deployed (`sha256:…`), set after each pull. */
  @Column({ name: 'image_digest', type: 'varchar', nullable: true })
  imageDigest: string | null;

  @Column({ name: 'image_checked_at', type: 'timestamptz', nullable: true })
  imageCheckedAt: Date | null;

  /**
   * `container` (default) = one plain container, blue/green by hand;
   * `service` = a swarm service (`replicas`, rolling update by the daemon).
   * Only for apps on the host daemon while it is a swarm manager.
   */
  @Column({ name: 'deploy_mode', type: 'varchar', default: 'container' })
  deployMode: DeployMode;

  @Column({ type: 'integer', default: 1 })
  replicas: number;

  /**
   * Service mode: pin tasks to one swarm node (`node.id`); null = any node.
   * Apps with mounts are always pinned to the aoox host, where their
   * volumes/files live (see deployment-runner).
   */
  @Column({ name: 'swarm_node_id', type: 'varchar', nullable: true })
  swarmNodeId: string | null;

  /** Extra placement constraint, e.g. `node.labels.zone==eu` or `node.role==worker` (see SWARM_CONSTRAINT). */
  @Column({ name: 'swarm_constraint', type: 'varchar', nullable: true })
  swarmConstraint: string | null;

  /** Rolling update: tasks updated at once (UpdateConfig.Parallelism). */
  @Column({ name: 'update_parallelism', type: 'integer', default: 1 })
  updateParallelism: number;

  /** Rolling update: pause between batches, seconds (UpdateConfig.Delay). */
  @Column({ name: 'update_delay_seconds', type: 'integer', default: 2 })
  updateDelaySeconds: number;

  /** `auto` = start-first unless a host port is published; or force one. */
  @Column({ name: 'update_order', type: 'varchar', default: 'auto' })
  updateOrder: UpdateOrder;

  @Column({ name: 'git_branch', default: 'main' })
  gitBranch: string;

  @Column({ name: 'dockerfile_path', default: 'Dockerfile' })
  dockerfilePath: string;

  @Column({ name: 'build_type', type: 'varchar', default: 'dockerfile' })
  buildType: BuildType;

  /** `static` only: optional build step, e.g. `npm ci && npm run build`. */
  @Column({ name: 'static_build_command', type: 'varchar', nullable: true })
  staticBuildCommand: string | null;

  /** `static` only: folder served by nginx (`dist`, `build`, `out`, `.`). */
  @Column({ name: 'static_output_dir', type: 'varchar', default: 'dist' })
  staticOutputDir: string;

  /** `static` only: serve index.html for unknown paths (client-side routing). */
  @Column({ name: 'static_spa', default: true })
  staticSpa: boolean;

  /**
   * Remote server whose Docker daemon runs this app; null = the aoox
   * host. Build happens on that daemon and the image stays there (no
   * registry push); the local proxy/domains do not apply.
   */
  @Column({ name: 'server_id', type: 'uuid', nullable: true })
  serverId: string | null;

  /**
   * HTTP path probed inside the container (e.g. `/health`). When set,
   * deployments wait for it and — for domain-routed apps without a host
   * port — swap containers blue/green so the old one keeps serving.
   */
  @Column({ name: 'healthcheck_path', type: 'varchar', nullable: true })
  healthcheckPath: string | null;

  /** Successful deployments (and their images) kept for rollback; older ones are pruned nightly. */
  @Column({ name: 'deployment_keep', type: 'int', default: 10 })
  deploymentKeep: number;

  /** Cron (5 fields) for automatic backups of every `volume` mount; null = disabled. */
  @Column({ name: 'backup_cron', type: 'varchar', nullable: true })
  backupCron: string | null;

  /** Scheduled volume backups kept per mount; older ones are deleted. */
  @Column({ name: 'backup_keep', type: 'int', default: 7 })
  backupKeep: number;

  /** Off-site copy of every volume backup; null = local volume only. */
  @Column({ name: 'backup_destination_id', type: 'uuid', nullable: true })
  backupDestinationId: string | null;

  @ManyToOne(() => BackupDestination, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'backup_destination_id' })
  backupDestination: BackupDestination | null;

  /** CPU limit in millicores (1000 = one core); null = unlimited. */
  @Column({ name: 'cpu_millicores', type: 'int', nullable: true })
  cpuMillicores: number | null;

  /** Memory limit in MiB (hard: swap pinned to the same value); null = unlimited. */
  @Column({ name: 'memory_mb', type: 'int', nullable: true })
  memoryMb: number | null;

  /**
   * Build and run every open pull request beside the app (opt-in: a PR
   * branch is arbitrary code; forks are ignored regardless).
   */
  @Column({ name: 'previews_enabled', default: false })
  previewsEnabled: boolean;

  /** Base domain for `<appName>-pr<N>.<previewDomain>`; null = PREVIEW_DOMAIN env. */
  @Column({ name: 'preview_domain', type: 'varchar', nullable: true })
  previewDomain: string | null;

  @ManyToOne(() => Server, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'server_id' })
  server: Server | null;

  /** Credentials for private repositories; null = anonymous clone. */
  @Column({ name: 'git_credential_id', type: 'uuid', nullable: true })
  gitCredentialId: string | null;

  @ManyToOne(() => GitCredential, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'git_credential_id' })
  gitCredential: GitCredential | null;

  /** Unguessable token in the webhook URL (`POST /webhooks/<token>`). Never selected by default. */
  @Column({
    name: 'webhook_token',
    type: 'varchar',
    unique: true,
    select: false,
  })
  webhookToken: string;

  /**
   * Optional shared secret the provider must prove on each delivery
   * (GitHub HMAC / GitLab token). null = URL token is the only auth.
   * AES-256-GCM via docker/secret.util like every other stored secret
   * (the token itself stays plaintext because it is the lookup key).
   */
  @Column({
    name: 'webhook_secret_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  webhookSecretEncrypted: string | null;

  /** Port the app listens on inside the container. */
  @Column({ name: 'container_port', type: 'int', default: 3000 })
  containerPort: number;

  /** Host port to publish; null = not published. */
  @Column({ name: 'host_port', type: 'int', nullable: true })
  hostPort: number | null;

  /**
   * `KEY=VALUE` lines, injected as container env on top of the project's
   * shared env. Values may reference `${{project.KEY}}` and
   * `${{database.<slug>.url|host|port|username|password|database}}`
   * (managed databases of the same project); resolved at container create.
   */
  @Column({ type: 'text', default: '' })
  env: string;

  /**
   * `KEY=VALUE` lines passed as Docker build args (`ARG` in the Dockerfile).
   * Baked into the image, so never secrets; no reference expansion.
   */
  @Column({ name: 'build_args', type: 'text', default: '' })
  buildArgs: string;

  @Column({ type: 'varchar', default: 'idle' })
  status: ApplicationStatus;

  /** Image currently running (set after a successful deployment). */
  @Column({ name: 'current_image', type: 'varchar', nullable: true })
  currentImage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
