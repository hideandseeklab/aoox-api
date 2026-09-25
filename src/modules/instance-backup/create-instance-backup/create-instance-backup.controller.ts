import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { InstanceBackup } from '../instance-backup.entity';
import { InstanceBackupService } from '../instance-backup.service';

/** Snapshots the panel database now and returns the finished record. */
@Controller('instance/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class CreateInstanceBackupController {
  constructor(private readonly backups: InstanceBackupService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(): Promise<InstanceBackup> {
    return this.backups.backup('manual');
  }
}
