import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import {
  BIND_MOUNT_ROLES,
  normalizePath,
} from '../add-mount/add-mount.service';
import { ApplicationService } from '../application.service';
import { DeploymentRunnerService } from '../deployment-runner.service';
import { Mount } from '../mount.entity';
import { MountParamsDto, UpdateMountDto } from './update-mount.dto';

/** Edits a mount (e.g. a config file's content) and re-creates the container. */
@Controller('applications')
@UseGuards(JwtAuthGuard)
export class UpdateMountController {
  constructor(
    private readonly applications: ApplicationService,
    private readonly runner: DeploymentRunnerService,
  ) {}

  @Patch(':id/mounts/:mountId')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: MountParamsDto,
    @Body() dto: UpdateMountDto,
  ): Promise<Mount> {
    const app = await this.applications.findOwnedOrFail(params.id, user.sub);
    const mount = await this.applications.mounts.findOne({
      where: { id: params.mountId, applicationId: app.id },
    });
    if (!mount) throw new NotFoundException('Mount not found');
    if (dto.containerPath !== undefined) {
      const containerPath = normalizePath(dto.containerPath);
      const clash = await this.applications.mounts.findOne({
        where: { applicationId: app.id, containerPath },
      });
      if (clash && clash.id !== mount.id) {
        throw new ConflictException(`${containerPath} is already mounted`);
      }
      mount.containerPath = containerPath;
    }
    if (dto.hostPath !== undefined && mount.type === 'bind') {
      if (!BIND_MOUNT_ROLES.has(user.role)) {
        throw new ForbiddenException('Only owners/admins can edit bind mounts');
      }
      mount.hostPath = normalizePath(dto.hostPath);
    }
    if (dto.content !== undefined && mount.type === 'file') {
      mount.content = dto.content;
    }
    if (dto.readOnly !== undefined && mount.type !== 'file') {
      mount.readOnly = dto.readOnly;
    }
    const saved = await this.applications.mounts.save(mount);
    await this.runner.applyRuntimeConfig(app);
    return saved;
  }
}
