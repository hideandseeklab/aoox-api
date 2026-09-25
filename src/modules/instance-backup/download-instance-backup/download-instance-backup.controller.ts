import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { InstanceBackupParamsDto } from '../instance-backup.dto';
import { InstanceBackupService } from '../instance-backup.service';

@Controller('instance/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class DownloadInstanceBackupController {
  constructor(private readonly backups: InstanceBackupService) {}

  @Get(':id/download')
  async download(
    @Param() params: InstanceBackupParamsDto,
    @Res() res: Response,
  ): Promise<void> {
    const backup = await this.backups.findOrFail(params.id);
    const name = backup.filename.split('/').pop() ?? 'instance.json.gz';
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="aoox-${name}"`);
    if (backup.sizeBytes) res.setHeader('Content-Length', backup.sizeBytes);
    try {
      await this.backups.download(backup, res);
    } catch (err) {
      if (res.headersSent) throw err;
      throw new NotFoundException(
        err instanceof Error ? err.message : String(err),
      );
    }
    res.end();
  }
}
