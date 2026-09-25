import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SignInResponseDto } from '../sign-in/sign-in.dto';
import { SetupDto } from './setup.dto';
import { SetupService } from './setup.service';

@Controller('auth')
export class SetupController {
  constructor(private readonly service: SetupService) {}

  // Brute-force protection: 10 attempts per minute per IP.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('setup')
  setup(@Body() dto: SetupDto): Promise<SignInResponseDto> {
    return this.service.execute(dto);
  }
}
