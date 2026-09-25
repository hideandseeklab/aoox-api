import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DockerService } from '../../docker/docker.service';
import { limitsRemoved, resourceLimits } from '../../docker/resource-limits';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { UpdateDatabaseDto } from './update-database.dto';
import { ManagedDatabase } from '../managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';

/**
 * Limits apply live through `POST /containers/{id}/update` (no restart);
 * removing a limit needs a recreate (short restart, data is in the volume)
 * because the update call ignores zeros. They are also baked into the
 * create body so a re-provision keeps them.
 */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class UpdateDatabaseController {
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
    const before = { cpuMillicores: db.cpuMillicores, memoryMb: db.memoryMb };
    if (dto.cpuMillicores !== undefined) db.cpuMillicores = dto.cpuMillicores;
    if (dto.memoryMb !== undefined) db.memoryMb = dto.memoryMb;
    const saved = await this.databases.repo.save(db);
    const changed =
      before.cpuMillicores !== saved.cpuMillicores ||
      before.memoryMb !== saved.memoryMb;
    const c = await this.docker.findContainerByName(containerNameForDb(db));
    if (c && changed) {
      if (limitsRemoved(before, saved)) {
        await this.databases.provision(
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
    return saved;
  }
}
