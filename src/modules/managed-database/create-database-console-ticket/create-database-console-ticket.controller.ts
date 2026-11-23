import {
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
import { DatabaseParamsDto } from '../get-database/get-database.dto';
import { CreateDatabaseConsoleTicketResponseDto } from './create-database-console-ticket.dto';
import { CreateDatabaseConsoleTicketService } from './create-database-console-ticket.service';

@Controller('databases')
@UseGuards(JwtAuthGuard)
export class CreateDatabaseConsoleTicketController {
  constructor(private readonly service: CreateDatabaseConsoleTicketService) {}

  @Post(':id/console-ticket')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: JwtPayload,
    @Param() params: DatabaseParamsDto,
  ): Promise<CreateDatabaseConsoleTicketResponseDto> {
    return this.service.execute(user.sub, params.id);
  }
}
