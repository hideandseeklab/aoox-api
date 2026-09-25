import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { SelfHostedStatusResponseDto } from './self-hosted-status.dto';
import { SelfHostedStatusService } from './self-hosted-status.service';

@Controller('registries')
@UseGuards(JwtAuthGuard)
export class SelfHostedStatusController {
  constructor(private readonly service: SelfHostedStatusService) {}

  @Get('self-hosted')
  status(): Promise<SelfHostedStatusResponseDto> {
    return this.service.execute();
  }
}
