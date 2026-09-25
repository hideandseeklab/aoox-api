import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBooleanString, IsOptional } from 'class-validator';
import { Repository } from 'typeorm';
import {
  BIND_MOUNT_ROLES,
  mountFields,
  normalizePath,
} from '../application/add-mount/add-mount.service';
import { Mount } from '../application/mount.entity';
import { volumeNameFor } from '../application/mounts';
import { UpdateMountDto } from '../application/update-mount/update-mount.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ComposeAppParamsDto } from '../compose/compose-app.dto';
import { ComposeApp } from '../compose/compose-app.entity';
import { ComposeService } from '../compose/compose.service';
import { DockerService } from '../docker/docker.service';
import { AddComposeMountDto, ComposeMountParamsDto } from './compose-mount.dto';

class DeleteMountQueryDto {
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}

/**
 * Mounts for compose stacks — same rules as application/database mounts, but
 * scoped to one `service` in the stack (a stack is N containers). Unlike
 * those, a change here does not re-provision anything by itself: like
 * `serviceDomains`/`serviceResources`, it only takes effect on the stack's
 * next deploy (compose is a client-side tool re-run from the row each time,
 * not a container the API can patch in place).
 */
@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class ComposeMountController {
  constructor(
    private readonly compose: ComposeService,
    private readonly docker: DockerService,
    @InjectRepository(Mount)
    private readonly mounts: Repository<Mount>,
  ) {}

  @Get(':id/mounts')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
  ): Promise<Mount[]> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    return this.mounts.find({
      where: { composeAppId: app.id },
      order: { createdAt: 'ASC' },
    });
  }

  @Post(':id/mounts')
  async add(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
    @Body() dto: AddComposeMountDto,
  ): Promise<Mount> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    const fields = mountFields(dto, user.role);
    if (
      await this.mounts.findOne({
        where: {
          composeAppId: app.id,
          service: dto.service,
          containerPath: fields.containerPath,
        },
      })
    ) {
      throw new ConflictException(
        `${fields.containerPath} is already mounted on ${dto.service}`,
      );
    }
    return this.mounts.save(
      this.mounts.create({
        composeAppId: app.id,
        service: dto.service,
        ...fields,
      }),
    );
  }

  @Patch(':id/mounts/:mountId')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeMountParamsDto,
    @Body() dto: UpdateMountDto,
  ): Promise<Mount> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    const mount = await this.find(app, params.mountId);
    if (dto.containerPath !== undefined) {
      const containerPath = normalizePath(dto.containerPath);
      const clash = await this.mounts.findOne({
        where: {
          composeAppId: app.id,
          // A compose mount always has a service (set at creation, never
          // cleared) — non-null here, not a fallback for a missing one.
          service: mount.service ?? '',
          containerPath,
        },
      });
      if (clash && clash.id !== mount.id) {
        throw new ConflictException(
          `${containerPath} is already mounted on ${mount.service}`,
        );
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
    return this.mounts.save(mount);
  }

  @Delete(':id/mounts/:mountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeMountParamsDto,
    @Query() query: DeleteMountQueryDto,
  ): Promise<void> {
    const app = await this.compose.findOwnedOrFail(params.id, user.sub);
    const mount = await this.find(app, params.mountId);
    await this.mounts.remove(mount);
    if (mount.type === 'volume' && query.purge === 'true') {
      await this.docker.engine
        .removeVolume(volumeNameFor({ slug: app.slug }, mount))
        .catch(() => undefined);
    }
  }

  private async find(app: ComposeApp, mountId: string): Promise<Mount> {
    const mount = await this.mounts.findOne({
      where: { id: mountId, composeAppId: app.id },
    });
    if (!mount) throw new NotFoundException('Mount not found');
    return mount;
  }
}
