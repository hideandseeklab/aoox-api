import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { CreateTicketDto, CreateTicketResponseDto } from './create-ticket.dto';
import { CreateTicketService } from './create-ticket.service';

@Controller('terminal')
@UseGuards(JwtAuthGuard)
export class CreateTicketController {
  constructor(private readonly service: CreateTicketService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('tickets')
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTicketDto,
  ): Promise<CreateTicketResponseDto> {
    return this.service.execute(user, dto);
  }
}
