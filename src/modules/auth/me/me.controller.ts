import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../current-user.decorator';
import { JwtAuthGuard } from '../jwt-auth.guard';
import type { JwtPayload } from '../jwt.strategy';
import { MeResponseDto } from './me.dto';
import { MeService } from './me.service';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly service: MeService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload): Promise<MeResponseDto> {
    return this.service.execute(user.sub);
  }
}
