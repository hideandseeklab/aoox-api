import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import {
  ApplicationLogsQueryDto,
  ApplicationLogsResponseDto,
} from './application-logs.dto';
import { ApplicationLogsService } from './application-logs.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationLogsController {
  constructor(private readonly service: ApplicationLogsService) {}

  @Get(':id/logs')
  logs(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Query() query: ApplicationLogsQueryDto,
  ): Promise<ApplicationLogsResponseDto> {
    return this.service.execute(user.sub, params.id, query.tail ?? 200);
  }
}
