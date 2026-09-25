import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { DatabaseParamsDto } from '../../managed-database/get-database/get-database.dto';
import { ManagedDatabaseService } from '../../managed-database/managed-database.service';
import { DatabaseBackup } from '../database-backup.entity';
import { DatabaseBackupService } from '../database-backup.service';

/** Runs a dump now and returns the finished record (dumps are usually seconds). */
@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CreateBackupController {
  constructor(
    private readonly databases: ManagedDatabaseService,
    private readonly backups: DatabaseBackupService,
  ) {}

  @Post(':id/backups')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<DatabaseBackup> {
    const db = await this.databases.findOwnedOrFail(params.id, user.sub);
    return this.backups.backup(db, 'manual');
  }
}
