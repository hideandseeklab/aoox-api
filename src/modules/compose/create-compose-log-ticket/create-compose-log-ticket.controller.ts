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
  CreateComposeLogTicketDto,
  CreateComposeLogTicketResponseDto,
} from './create-compose-log-ticket.dto';
import { CreateComposeLogTicketService } from './create-compose-log-ticket.service';

@Controller('compose-apps')
@UseGuards(JwtAuthGuard)
export class CreateComposeLogTicketController {
  constructor(private readonly service: CreateComposeLogTicketService) {}

  @Post(':id/log-ticket')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: ComposeAppParamsDto,
    @Body() dto: CreateComposeLogTicketDto,
  ): Promise<CreateComposeLogTicketResponseDto> {
    return this.service.execute(user.sub, params.id, dto);
  }
}
