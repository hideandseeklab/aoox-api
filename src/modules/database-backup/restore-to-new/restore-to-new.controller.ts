import {
  Body,
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
import { ManagedDatabase } from '../../managed-database/managed-database.entity';
import { RestoreToNewDto, RestoreToNewParamsDto } from './restore-to-new.dto';
import { RestoreToNewService } from './restore-to-new.service';

/** Restores a backup into a brand new database; the source is never touched. */
@Controller('backups')
@UseGuards(JwtAuthGuard)
export class RestoreToNewController {
  constructor(private readonly service: RestoreToNewService) {}

  @Post(':id/restore-to-new')
  @HttpCode(HttpStatus.ACCEPTED)
  restoreToNew(
    @CurrentUser() user: JwtPayload,
    @Param() params: RestoreToNewParamsDto,
    @Body() dto: RestoreToNewDto,
  ): Promise<ManagedDatabase> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
