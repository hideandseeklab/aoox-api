import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  SignInDto,
  SignInResponseDto,
  SignInTwoFactorDto,
  TwoFactorRequiredDto,
} from './sign-in.dto';
import { SignInService } from './sign-in.service';

@Controller('auth')
export class SignInController {
  constructor(private readonly signInService: SignInService) {}

  // Brute-force protection: 10 attempts per minute per IP.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(
    @Body() dto: SignInDto,
    @Ip() ip: string,
  ): Promise<SignInResponseDto | TwoFactorRequiredDto> {
    return this.signInService.execute(dto, ip);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sign-in/2fa')
  @HttpCode(HttpStatus.OK)
  signInTwoFactor(
    @Body() dto: SignInTwoFactorDto,
    @Ip() ip: string,
  ): Promise<SignInResponseDto> {
    return this.signInService.executeTwoFactor(dto, ip);
  }
}
