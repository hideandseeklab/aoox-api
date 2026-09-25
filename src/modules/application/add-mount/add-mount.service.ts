import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { Mount } from '../mount.entity';
import { AddMountDto } from './add-mount.dto';

/** Bind mounts expose the host filesystem, so only the roles with a host shell may add them. */
export const BIND_MOUNT_ROLES = new Set(['owner', 'admin']);

@Injectable()
export class AddMountService {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
  ) {}

  async execute(
    user: JwtPayload,
    applicationId: string,
    dto: AddMountDto,
  ): Promise<Mount> {
    const app = await this.applications.findOwnedOrFail(
      applicationId,
      user.sub,
    );
    const containerPath = normalizePath(dto.containerPath);
    if (
      await this.applications.mounts.findOne({
        where: { applicationId: app.id, containerPath },
      })
    ) {
      throw new ConflictException(`${containerPath} is already mounted`);
    }
    const mount = this.applications.mounts.create({
      applicationId: app.id,
      ...mountFields(dto, user.role),
    });
    const saved = await this.applications.mounts.save(mount);
    await this.runner.applyRuntimeConfig(app);
    return saved;
  }
}

/** Collapses duplicate slashes and trailing slash (`/` stays `/`). */
export function normalizePath(p: string): string {
  const out = p
    .trim()
    .replace(/\/+/g, '/')
    .replace(/(.)\/$/, '$1');
  return out || '/';
}

/**
 * Column values for a new mount from its DTO (shared with database mounts):
 * validates per type and applies the bind-mount role rule.
 */
export function mountFields(
  dto: AddMountDto,
  role: string,
): Pick<
  Mount,
  'type' | 'containerPath' | 'readOnly' | 'name' | 'hostPath' | 'content'
> {
  const containerPath = normalizePath(dto.containerPath);
  const base = {
    type: dto.type,
    containerPath,
    readOnly: dto.readOnly ?? false,
    name: null as string | null,
    hostPath: null as string | null,
    content: null as string | null,
  };
  if (dto.type === 'volume') {
    if (!dto.name) throw new BadRequestException('name is required');
    return { ...base, name: dto.name };
  }
  if (dto.type === 'bind') {
    if (!BIND_MOUNT_ROLES.has(role)) {
      throw new ForbiddenException('Only owners/admins can add bind mounts');
    }
    if (!dto.hostPath) throw new BadRequestException('hostPath is required');
    return { ...base, hostPath: normalizePath(dto.hostPath) };
  }
  // File: the container path's basename is the file name inside the files volume.
  return {
    ...base,
    name: dto.name ?? containerPath.split('/').pop() ?? 'file',
    content: dto.content ?? '',
    readOnly: true,
  };
}
