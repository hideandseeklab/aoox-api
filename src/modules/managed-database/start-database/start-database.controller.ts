import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DockerService } from '../../docker/docker.service';
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { ManagedDatabase } from '../managed-database.entity';
import {
  containerNameForDb,
  ManagedDatabaseService,
} from '../managed-database.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class StartDatabaseController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly docker: DockerService,
  ) {}

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<ManagedDatabase> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    const c = await this.docker.findContainerByName(containerNameForDb(db));
    if (!c) throw new NotFoundException('Database has no container');
    await this.docker.engine.startContainer(c.Id);
    db.status = 'running';
    return this.databases.repo.save(db);
  }
}
