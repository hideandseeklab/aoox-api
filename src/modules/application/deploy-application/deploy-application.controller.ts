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
import { Deployment } from '../deployment.entity';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { DeployApplicationService } from './deploy-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class DeployApplicationController {
  constructor(private readonly service: DeployApplicationService) {}

  @Post(':id/deploy')
  @HttpCode(HttpStatus.ACCEPTED)
  deploy(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Deployment> {
    return this.service.execute(user.sub, params.id);
  }
}
