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
import { ComposeAppParamsDto } from '../compose-app.dto';
import {
  CreateComposeConsoleTicketDto,
  CreateComposeConsoleTicketResponseDto,
} from './create-compose-console-ticket.dto';
import { CreateComposeConsoleTicketService } from './create-compose-console-ticket.service';

@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class CreateComposeConsoleTicketController {
  constructor(private readonly service: CreateComposeConsoleTicketService) {}

  @Post(':id/console-ticket')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
    @Body() dto: CreateComposeConsoleTicketDto,
  ): Promise<CreateComposeConsoleTicketResponseDto> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
