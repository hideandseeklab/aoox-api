import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { Deployment } from '../deployment.entity';
import { DeploymentParamsDto } from './get-deployment.dto';
import { GetDeploymentService } from './get-deployment.service';

@Controller('deployments')
@UseGuards(JwtAuthGuard)
export class GetDeploymentController {
  constructor(private readonly service: GetDeploymentService) {}

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param() params: DeploymentParamsDto,
  ): Promise<Deployment> {
    return this.service.execute(user.sub, params.id);
  }
}
