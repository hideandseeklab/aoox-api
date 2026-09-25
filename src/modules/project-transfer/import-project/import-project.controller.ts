import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ImportReport } from '../project-export.types';
import { ImportProjectDto } from './import-project.dto';
import { ImportProjectService } from './import-project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ImportProjectController {
  constructor(private readonly service: ImportProjectService) {}

  /** Creates a new project from an export file; databases are provisioned in the background. */
  @Post('import')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  import(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ImportProjectDto,
  ): Promise<ImportReport> {
    return this.service.execute(user, dto);
  }
}
