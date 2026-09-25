import {
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
import { Application } from '../application.entity';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { StopApplicationService } from './stop-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class StopApplicationController {
  constructor(private readonly service: StopApplicationService) {}

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Application> {
    return this.service.execute(user.sub, params.id);
  }
}
