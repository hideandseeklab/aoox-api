import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { AuthorizeTerminalResultDto } from './authorize-terminal.dto';
import { AuthorizeTerminalService } from './authorize-terminal.service';

@Controller('terminal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
export class AuthorizeTerminalController {
  constructor(private readonly service: AuthorizeTerminalService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('authorize')
  @HttpCode(200)
  authorize(): Promise<AuthorizeTerminalResultDto> {
    return this.service.execute();
  }
}
