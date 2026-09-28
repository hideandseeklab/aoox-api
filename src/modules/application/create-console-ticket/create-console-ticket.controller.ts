import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { JwtPayload } from '../../auth/jwt.strategy';
import { ApplicationParamsDto } from '../get-application/get-application.dto';
import {
  CreateConsoleTicketDto,
  CreateConsoleTicketResponseDto,
} from './create-console-ticket.dto';
import { CreateConsoleTicketService } from './create-console-ticket.service';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class CreateConsoleTicketController {
  constructor(private readonly service: CreateConsoleTicketService) {}

  @Post(':id/console-ticket')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: ApplicationParamsDto,
    @Body() dto: CreateConsoleTicketDto,
  ): Promise<CreateConsoleTicketResponseDto> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
