import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from './get-application.dto';
import {
  ApplicationDetail,
  GetApplicationService,
} from './get-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class GetApplicationController {
  constructor(private readonly service: GetApplicationService) {}

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<ApplicationDetail> {
    return this.service.execute(user.sub, params.id);
  }
}
