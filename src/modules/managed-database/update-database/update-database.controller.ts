import {
  BadGatewayException,
  Body,
  Controller,
  HttpException,
  Logger,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DockerService } from '../../docker/docker.service';
import { limitsRemoved, resourceLimits } from '../../docker/resource-limits';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { UpdateDatabaseDto } from './update-database.dto';
import { assertNotStarting } from '../database-starting';
import { ManagedDatabase } from '../managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
  reprovisionTouchedContainer,
} from '../managed-database.service';

/**
 * Limits apply live through `POST /containers/{id}/update` (no restart);
 * removing a limit needs a recreate (short restart, data is in the volume)
 * because the update call ignores zeros. They are also baked into the
 * create body so a re-provision keeps them.
 *
 * The limits are saved first (the re-provision reads them from the row). When
 * applying fails before the container was touched, the previous values are
 * restored and the error is rethrown, as the mount routes do. After the
 * container was touched the new limits stay and the row is `error` (retry
 * provisioning). A database in `error` only stores the limits: the retry
 * applies them.
 */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class UpdateDatabaseController {
  private readonly logger = new Logger(UpdateDatabaseController.name);

  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
  ) {}

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
    @Body() dto: UpdateDatabaseDto,
  ): Promise<ManagedDatabase> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    assertNotStarting(db);
    const before = { cpuMillicores: db.cpuMillicores, memoryMb: db.memoryMb };
    if (dto.cpuMillicores !== undefined) db.cpuMillicores = dto.cpuMillicores;
    if (dto.memoryMb !== undefined) db.memoryMb = dto.memoryMb;
    const saved = await this.databases.repo.save(db);
    const changed =
      before.cpuMillicores !== saved.cpuMillicores ||
      before.memoryMb !== saved.memoryMb;
    if (!changed || saved.status === 'error') return saved;
    try {
      const c = await this.docker.findContainerByName(containerNameForDb(db));
      if (c) {
        if (limitsRemoved(before, saved)) {
          await this.databases.reprovision(
            saved,
            await this.databases.password(saved),
          );
        } else {
          await this.docker.engine.updateContainer(
            c.Id,
            resourceLimits(saved.cpuMillicores, saved.memoryMb),
          );
        }
      }
    } catch (err) {
      if (!reprovisionTouchedContainer(err)) {
        await this.databases.repo
          .update(db.id, before)
          .catch((e: unknown) =>
            this.logger.error(
              `Could not restore the limits of ${db.slug}: ${String(e)}`,
            ),
          );
      }
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(
        `Could not apply the limits on the container: ${message}`,
      );
    }
    return saved;
  }
}
