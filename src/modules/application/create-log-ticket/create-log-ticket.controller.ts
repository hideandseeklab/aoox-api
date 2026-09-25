import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import { CreateLogTicketResponseDto } from './create-log-ticket.dto';
import { CreateLogTicketService } from './create-log-ticket.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CreateLogTicketController {
  constructor(private readonly service: CreateLogTicketService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/log-ticket')
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
  ): Promise<CreateLogTicketResponseDto> {
    return this.service.execute(user.sub, params.id);
  }
}
