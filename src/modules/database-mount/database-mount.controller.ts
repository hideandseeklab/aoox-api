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
import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';
import { AddMountDto } from '../application/add-mount/add-mount.dto';
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
import { DockerService } from '../docker/docker.service';
import { DatabaseParamsDto } from '../managed-database/get-database/get-database.dto';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database/managed-database.service';

class DatabaseMountParamsDto {
  @IsUUID()
  id: string;

  @IsUUID()
  mountId: string;
}

class DeleteMountQueryDto {
  @IsOptional()
  @IsBooleanString()
  purge?: string;
}

/**
 * Mounts for managed databases (`postgresql.conf`, `my.cnf`, `redis.conf`,
 * extra volumes). Same rules as application mounts; every change
 * re-provisions the container (short restart, data stays in its volume).
 */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DatabaseMountController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
  ) {}

  @Get(':id/mounts')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<Mount[]> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.databases.mounts.find({
      where: { databaseId: db.id },
      order: { createdAt: 'ASC' },
    });
  }

  @Post(':id/mounts')
  async add(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: AddMountDto,
  ): Promise<Mount> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const fields = mountFields(dto, user.role);
    if (
      await this.databases.mounts.findOne({
        where: { databaseId: db.id, containerPath: fields.containerPath },
      })
    ) {
      throw new ConflictException(`${fields.containerPath} is already mounted`);
    }
    const saved = await this.databases.mounts.save(
      this.databases.mounts.create({ databaseId: db.id, ...fields }),
    );
    await this.apply(db);
    return saved;
  }

  @Patch(':id/mounts/:mountId')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseMountParamsDto,
    @Body() dto: UpdateMountDto,
  ): Promise<Mount> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const mount = await this.find(db, params.mountId);
    if (dto.containerPath !== undefined) {
      const containerPath = normalizePath(dto.containerPath);
      const clash = await this.databases.mounts.findOne({
        where: { databaseId: db.id, containerPath },
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
    const saved = await this.databases.mounts.save(mount);
    await this.apply(db);
    return saved;
  }

  @Delete(':id/mounts/:mountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseMountParamsDto,
    @Query() query: DeleteMountQueryDto,
  ): Promise<void> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const mount = await this.find(db, params.mountId);
    await this.databases.mounts.remove(mount);
    await this.apply(db);
    if (mount.type === 'volume' && query.purge === 'true') {
      await this.docker.engine
        .removeVolume(volumeNameFor(db, mount))
        .catch(() => undefined);
    }
  }

  private async find(db: ManagedDatabase, mountId: string): Promise<Mount> {
    const mount = await this.databases.mounts.findOne({
      where: { id: mountId, databaseId: db.id },
    });
    if (!mount) throw new NotFoundException('Mount not found');
    return mount;
  }

  /** Re-creates the container with the current mounts (no-op while still provisioning/errored). */
  private async apply(db: ManagedDatabase): Promise<void> {
    if (db.status !== 'running' && db.status !== 'stopped') return;
    const password = await this.databases.password(db);
    await this.databases.provision(db, password);
    if (db.status === 'stopped') {
      const c = await this.docker.findContainerByName(containerNameForDb(db));
      if (c) await this.docker.engine.stopContainer(c.Id);
    }
  }
}
