import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { InstanceBackupParamsDto } from '../instance-backup.dto';
import {
  InstanceBackupService,
  RestoreReport,
} from '../instance-backup.service';

/** Replaces every table with the snapshot's rows (this server's backup list is merged, not lost). */
@Controller('instance/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RestoreInstanceBackupController {
  constructor(private readonly backups: InstanceBackupService) {}

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async restore(
    @Param() params: InstanceBackupParamsDto,
  ): Promise<RestoreReport> {
    const backup = await this.backups.findOrFail(params.id);
    return this.backups.restore(backup);
  }
}
