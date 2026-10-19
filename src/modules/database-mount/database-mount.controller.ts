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
  Logger,
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
import { mountView, MountView, volumeNameFor } from '../application/mounts';
import { UpdateMountDto } from '../application/update-mount/update-mount.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { DockerService } from '../docker/docker.service';
import { ProjectAccessService } from '../project/project-access.service';
import { DatabaseParamsDto } from '../managed-database/get-database/get-database.dto';
import { assertNotStarting } from '../managed-database/database-starting';
import { ManagedDatabase } from '../managed-database/managed-database.entity';
import {
  ManagedDatabaseService,
  reprovisionTouchedContainer,
} from '../managed-database/managed-database.service';
import { assertMountPathAllowed } from '../managed-database/mount-path';

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
 *
 * The row change is saved first and applied second. If the apply fails
 * before the old container was touched (image pull, PostgreSQL layout 409),
 * the row change is undone and the error rethrown, so the saved state keeps
 * matching the running container. If it fails after the container was
 * touched, the database is in `error` and the change is kept: "Retry
 * provisioning" recovers it, and a mount can be deleted while in `error`
 * (that applies nothing).
 */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class DatabaseMountController {
  private readonly logger = new Logger(DatabaseMountController.name);

  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get(':id/mounts')
  async list(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<MountView[]> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const canRead = await this.access.canReadSecrets(user.sub, db.project);
    const mounts = await this.databases.mounts.find({
      where: { databaseId: db.id },
      order: { createdAt: 'ASC' },
    });
    return mounts.map((m) => mountView(m, canRead));
  }

  @Post(':id/mounts')
  async add(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: AddMountDto,
  ): Promise<Mount> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    assertNotStarting(db);
    const fields = mountFields(dto, user.role);
    assertMountPathAllowed(db.engine, fields.containerPath);
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
    await this.applyOrUndo(db, () => this.databases.mounts.remove(saved));
    return saved;
  }

  @Patch(':id/mounts/:mountId')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseMountParamsDto,
    @Body() dto: UpdateMountDto,
  ): Promise<Mount> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    assertNotStarting(db);
    const mount = await this.find(db, params.mountId);
    const previous = { ...mount };
    if (dto.containerPath !== undefined) {
      const containerPath = normalizePath(dto.containerPath);
      assertMountPathAllowed(db.engine, containerPath);
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
    await this.applyOrUndo(db, () => this.databases.mounts.save(previous));
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
    assertNotStarting(db);
    const mount = await this.find(db, params.mountId);
    // `remove` clears the id of the entity it is given: keep a copy to re-insert.
    const previous = { ...mount };
    await this.databases.mounts.remove(mount);
    await this.applyOrUndo(db, () =>
      this.databases.mounts.save(this.databases.mounts.create(previous)),
    );
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

  /** `apply`, undoing the row change when nothing was touched on the daemon. */
  private async applyOrUndo(
    db: ManagedDatabase,
    undo: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await this.apply(db);
    } catch (err) {
      if (!reprovisionTouchedContainer(err)) {
        await undo().catch((e: unknown) =>
          this.logger.error(
            `Could not undo the mount change of ${db.slug}: ${String(e)}`,
          ),
        );
      }
      throw err;
    }
  }

  /** Re-creates the container with the current mounts (no-op while still provisioning/errored). */
  private async apply(db: ManagedDatabase): Promise<void> {
    if (db.status !== 'running' && db.status !== 'stopped') return;
    const password = await this.databases.password(db);
    await this.databases.reprovision(db, password);
  }
}
