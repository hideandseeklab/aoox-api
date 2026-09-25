import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ProjectExport } from '../project-export.types';
import {
  ExportProjectParamsDto,
  ExportProjectQueryDto,
} from './export-project.dto';
import { ExportProjectService } from './export-project.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ExportProjectController {
  constructor(private readonly service: ExportProjectService) {}

  /** JSON description of the project; the web wraps it as a file download. */
  @Get(':id/export')
  @Header('Cache-Control', 'no-store')
  export(
    @CurrentUser() user: JwtPayload,
    @Param() params: ExportProjectParamsDto,
    @Query() query: ExportProjectQueryDto,
  ): Promise<ProjectExport> {
    return this.service.execute(
      user,
      params.id,
      query.includeSecrets === 'true',
    );
  }
}
