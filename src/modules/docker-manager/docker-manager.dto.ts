import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { ManagedInfo } from './managed';

/** `?serverId=` picks the daemon: omitted = the aoox host, otherwise a registered remote server. */
export class DockerTargetQueryDto {
  @IsOptional()
  @IsUUID()
  serverId?: string;
}

export class ContainerLogsQueryDto extends DockerTargetQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  tail?: number;
}

export class RemoveContainerQueryDto extends DockerTargetQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  force?: boolean;
}

export class DockerContainerDto {
  /** Full 64-hex id. */
  id: string;
  name: string;
  image: string;
  state: string;
  /** Docker's human status, e.g. "Up 2 hours". */
  status: string;
  createdAt: string | null;
  ports: {
    ip: string | null;
    privatePort: number;
    publicPort: number | null;
    type: string;
  }[];
  /** Non-null = owned by aoox: no stop/restart/remove from the Docker page. */
  managed: ManagedInfo | null;
}

export class DockerContainerLogsDto {
  logs: string;
  /** Older lines (or characters) were cut to keep the response small. */
  truncated: boolean;
}

export class DockerImageDto {
  /** `sha256:…` */
  id: string;
  tags: string[];
  size: number;
  createdAt: string;
  /** Containers (any state) created from this image. */
  usedBy: number;
  usedByNames: string[];
  dangling: boolean;
  /** aoox helper/panel image: not removable from here. */
  managed: boolean;
  /** Why this image cannot be removed here (rollback/registry/preview), or null. */
  protectedReason: string | null;
}

export class DockerVolumeDto {
  name: string;
  driver: string;
  /** Bytes; null when the daemon did not compute it. */
  size: number | null;
  createdAt: string | null;
  usedByNames: string[];
  managed: boolean;
  /** aoox volume whose owning project/app/database no longer exists (host only). */
  orphan: boolean;
}

export class DockerNetworkDto {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet: string | null;
  usedByNames: string[];
  builtin: boolean;
  managed: boolean;
}

export class PruneImagesResultDto {
  deleted: number;
  reclaimedBytes: number;
}

/** One published host port (containers listing merged per port; see `toOpenPorts`). */
export class OpenPortDto {
  /** Host port. */
  port: number;
  protocol: string;
  /** Port inside the container. */
  containerPort: number;
  /** IPs Docker reports for the binding (`0.0.0.0`, `::`, `127.0.0.1`...). */
  addresses: string[];
  /** `public` = every interface, `loopback` = 127.0.0.1/::1 only, `address` = one specific other IP. */
  exposure: 'public' | 'loopback' | 'address';
  /** Anything but loopback: has to be blocked by the provider firewall, ufw does not filter it. */
  openToInternet: boolean;
  containerId: string;
  containerName: string;
  image: string;
  /** Owner by aoox labels; null = not managed by aoox. */
  managed: ManagedInfo | null;
}
