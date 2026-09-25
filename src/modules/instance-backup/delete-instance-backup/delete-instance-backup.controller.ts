import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { InstanceBackupParamsDto } from '../instance-backup.dto';
import { InstanceBackupService } from '../instance-backup.service';

@Controller('instance/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class DeleteInstanceBackupController {
  constructor(private readonly backups: InstanceBackupService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param() params: InstanceBackupParamsDto): Promise<void> {
    await this.backups.delete(await this.backups.findOrFail(params.id));
  }
}
