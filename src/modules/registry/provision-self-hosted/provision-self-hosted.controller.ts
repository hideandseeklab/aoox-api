import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import {
  ProvisionSelfHostedDto,
  ProvisionSelfHostedResponseDto,
} from './provision-self-hosted.dto';
import { ProvisionSelfHostedService } from './provision-self-hosted.service';

@Controller('registries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class ProvisionSelfHostedController {
  constructor(private readonly service: ProvisionSelfHostedService) {}

  @Post('self-hosted')
  provision(
    @Body() dto: ProvisionSelfHostedDto,
  ): Promise<ProvisionSelfHostedResponseDto> {
    return this.service.execute(dto);
  }
}
