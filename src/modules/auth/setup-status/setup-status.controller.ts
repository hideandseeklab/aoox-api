import { Controller, Get } from '@nestjs/common';
import { SetupStatusResponseDto } from './setup-status.dto';
import { SetupStatusService } from './setup-status.service';
import { ThrottleByIp } from '../throttle-by-ip.decorator';

@ThrottleByIp()
@Controller('auth')
export class SetupStatusController {
  constructor(private readonly service: SetupStatusService) {}

  @Get('setup-status')
  status(): Promise<SetupStatusResponseDto> {
    return this.service.execute();
  }
}
