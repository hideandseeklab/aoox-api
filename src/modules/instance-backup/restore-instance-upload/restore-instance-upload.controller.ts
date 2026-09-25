import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  InstanceBackupService,
  RestoreReport,
  SNAPSHOT_MAX_BYTES,
} from '../instance-backup.service';

/** Restore from an uploaded `.json.gz` — the path for a brand-new server. */
@Controller('instance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class RestoreInstanceUploadController {
  constructor(private readonly backups: InstanceBackupService) {}

  @Post('restore')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: SNAPSHOT_MAX_BYTES } }),
  )
  restore(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<RestoreReport> {
    if (!file) throw new BadRequestException('Upload the backup as "file"');
    return this.backups.restoreFromBuffer(file.buffer);
  }
}
