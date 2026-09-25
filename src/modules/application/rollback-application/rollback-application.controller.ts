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
import { Deployment } from '../deployment.entity';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { RollbackApplicationDto } from './rollback-application.dto';
import { RollbackApplicationService } from './rollback-application.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class RollbackApplicationController {
  constructor(private readonly service: RollbackApplicationService) {}

  @Post(':id/rollback')
  @HttpCode(HttpStatus.ACCEPTED)
  rollback(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: RollbackApplicationDto,
  ): Promise<Deployment> {
    return this.service.execute(user.sub, params.id, dto.deploymentId);
  }
}
