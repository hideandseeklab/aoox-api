import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Application } from '../application.entity';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { UpdateApplicationDto } from './update-application.dto';
import { UpdateApplicationService } from './update-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class UpdateApplicationController {
  constructor(private readonly service: UpdateApplicationService) {}

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: UpdateApplicationDto,
  ): Promise<Application> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
