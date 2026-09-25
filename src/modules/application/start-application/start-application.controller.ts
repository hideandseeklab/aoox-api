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
import { StartApplicationService } from './start-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class StartApplicationController {
  constructor(private readonly service: StartApplicationService) {}

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Application> {
    return this.service.execute(user.sub, params.id);
  }
}
