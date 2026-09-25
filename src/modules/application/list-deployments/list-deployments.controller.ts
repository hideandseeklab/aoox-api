import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Deployment } from '../deployment.entity';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { ListDeploymentsService } from './list-deployments.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ListDeploymentsController {
  constructor(private readonly service: ListDeploymentsService) {}

  @Get(':id/deployments')
  list(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<Omit<Deployment, 'logs' | 'application'>[]> {
    return this.service.execute(user.sub, params.id);
  }
}
