import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  SWARM_CONSTRAINT,
  type BuildType,
  type DeployMode,
  type SourceType,
  type UpdateOrder,
} from '../application.entity';

export class UpdateApplicationDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^(https?|git):\/\/[^\s#@]+$/, {
    message:
      'gitUrl must be an http(s) or git URL without embedded credentials',
  })
  gitUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[\w./-]{1,100}$/)
  gitBranch?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[\w./-]{1,200}$/)
  dockerfilePath?: string;

  /** null clears the credential. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  gitCredentialId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  containerPort?: number;

  /** null clears the published port. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  hostPort?: number | null;

  /** CPU limit in millicores (500 = half a core); null = unlimited. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(64_000)
  cpuMillicores?: number | null;

  /** e.g. `/health`; null = no health check (plain replace). */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^\/[^\s]*$/, { message: 'healthcheckPath must start with /' })
  healthcheckPath?: string | null;

  /** Memory limit in MiB; null = unlimited. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(1_048_576)
  memoryMb?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  env?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  buildArgs?: string;

  @IsOptional()
  @IsIn(['dockerfile', 'nixpacks', 'railpack', 'static'])
  buildType?: BuildType;

  /** `git` (default) or `image`. */
  @IsOptional()
  @IsIn(['git', 'image'])
  sourceType?: SourceType;

  /** `image` source: full reference, e.g. `ghcr.io/org/app:1.2`. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^[a-z0-9][a-z0-9._\-/:@]*$/, {
    message: 'imageRef must be an image reference like registry/repo:tag',
  })
  imageRef?: string;

  /** `image` source: registry (Registry page) whose credentials pull it; null = public. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  imageRegistryId?: string | null;

  /** `image` source: redeploy automatically when the tag's digest changes. */
  @IsOptional()
  @IsBoolean()
  autoUpdate?: boolean;

  /** Minutes between registry checks (5–1440). */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  autoUpdateIntervalMinutes?: number;

  /** `container` (default) or `service` (swarm; host daemon must be a manager). */
  @IsOptional()
  @IsIn(['container', 'service'])
  deployMode?: DeployMode;

  /** Service mode: number of tasks (1-20). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  replicas?: number;

  /** Service mode: swarm node id to pin tasks to; null = any node. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]{10,64}$/, { message: 'swarmNodeId is not a node id' })
  swarmNodeId?: string | null;

  /** Service mode: extra placement constraint, e.g. `node.labels.zone==eu`. */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(SWARM_CONSTRAINT, {
    message:
      'swarmConstraint must look like node.labels.<key>==<value>, node.role==worker or node.hostname!=<name>',
  })
  swarmConstraint?: string | null;

  /** Rolling update: tasks updated at once (1-20). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  updateParallelism?: number;

  /** Rolling update: seconds between batches (0-600). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  updateDelaySeconds?: number;

  @IsOptional()
  @IsIn(['auto', 'start-first', 'stop-first'])
  updateOrder?: UpdateOrder;

  /** `static` build type: build command (null = files already in the repo). */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  staticBuildCommand?: string | null;

  /** `static` build type: output folder relative to the repo root. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^(?!\/)(?!.*\.\.)[\w./-]+$/, {
    message: 'staticOutputDir must be a relative folder',
  })
  staticOutputDir?: string;

  @IsOptional()
  @IsBoolean()
  staticSpa?: boolean;

  /** Remote server to run on; null/omitted = the aoox host. */
  @IsOptional()
  @IsUUID()
  serverId?: string | null;

  @IsOptional()
  @IsBoolean()
  previewsEnabled?: boolean;

  /** e.g. `preview.example.com` (wildcard DNS `*.preview.example.com` -> this host). */
  @IsOptional()
  @IsString()
  @MaxLength(253)
  @Matches(/^([a-z0-9-]+\.)+[a-z0-9-]+$/i, {
    message: 'previewDomain must be a bare domain like preview.example.com',
  })
  previewDomain?: string | null;

  /** Successful deployments kept for rollback (1–100). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  deploymentKeep?: number;
}
